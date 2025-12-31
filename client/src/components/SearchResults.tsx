'use client';

import { useState, useEffect } from 'react';

interface SearchResultsProps {
  searchId: string;
}

interface GradingState {
  [listingId: string]: {
    isGrading: boolean;
    error: string | null;
    progress: number;
  };
}

interface Listing {
  id: string;
  ebayItemId: string;
  url: string;
  title: string;
  price: number;
  shippingCost: number;
  currency: string;
  seller: {
    username: string;
    feedbackScore: number;
    feedbackPercent: number;
  };
  condition: string;
  endTime: string;
  images: string[];
  evaluation: {
    cardName: string | null;
    cardSet: string | null;
    cardNumber: string | null;
    predictedGradeMin: number | null;
    predictedGradeMax: number | null;
    gradeConfidence: number;
    expectedValue: number;
    dealMargin: number;
    dealScore: number;
    isQualified: boolean;
    qualificationFlags: string[];
  } | null;
}

interface SearchData {
  searchId: string;
  status: string;
  progress: {
    total: number;
    processed: number;
    qualified: number;
  };
  listings: Listing[];
}

export default function SearchResults({ searchId }: SearchResultsProps) {
  const [searchData, setSearchData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [gradingStates, setGradingStates] = useState<GradingState>({});
  const [originalOrder, setOriginalOrder] = useState<string[]>([]);
  const itemsPerPage = 25;

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const response = await fetch(`http://localhost:3001/api/search/${searchId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch search results');
        }
        const data = await response.json();
        console.log('Search data received:', data);
        console.log('Listings count:', data.listings?.length);
        
        // Store original order on first load
        if (originalOrder.length === 0 && data.listings?.length > 0) {
          setOriginalOrder(data.listings.map((l: Listing) => l.id));
          console.log('📌 Locked listing order:', data.listings.length, 'listings');
        }
        
        // Restore original order if we have it
        if (originalOrder.length > 0 && data.listings?.length > 0) {
          const orderedListings = [...data.listings].sort((a, b) => {
            const indexA = originalOrder.indexOf(a.id);
            const indexB = originalOrder.indexOf(b.id);
            return indexA - indexB;
          });
          data.listings = orderedListings;
          console.log('🔄 Restored original listing order');
        }
        
        setSearchData(data);
      } catch (err) {
        console.error('Error fetching results:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
    
    // Poll for updates if search is still processing
    const interval = setInterval(() => {
      if (searchData?.status === 'PROCESSING' || searchData?.status === 'PENDING' || searchData?.status === 'IN_PROGRESS') {
        fetchResults();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [searchId, searchData?.status]);

  const gradeListingOnDemand = async (listingId: string) => {
    // Set grading state
    setGradingStates(prev => ({
      ...prev,
      [listingId]: { isGrading: true, error: null, progress: 0 }
    }));

    try {
      const response = await fetch(
        `http://localhost:3001/api/search/${searchId}/listing/${listingId}/grade`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        
        console.error('Grading API error:', errorData);
        console.error('Response status:', response.status);
        console.error('Response headers:', Object.fromEntries(response.headers.entries()));
        
        const errorMessage = errorData.message || errorData.error || JSON.stringify(errorData) || 'Grading failed';
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log(`✅ Grading completed for listing ${listingId}:`, result);

      // Update grading state to complete
      setGradingStates(prev => ({
        ...prev,
        [listingId]: { isGrading: false, error: null, progress: 100 }
      }));

      // Refresh the listing data to show updated grades
      const searchResponse = await fetch(`http://localhost:3001/api/search/${searchId}`);
      if (searchResponse.ok) {
        const updatedData = await searchResponse.json();
        console.log(`📊 Updated data received. Total listings: ${updatedData.listings.length}`);
        
        // Restore original order
        if (originalOrder.length > 0) {
          const orderedListings = [...updatedData.listings].sort((a, b) => {
            const indexA = originalOrder.indexOf(a.id);
            const indexB = originalOrder.indexOf(b.id);
            return indexA - indexB;
          });
          updatedData.listings = orderedListings;
          console.log('🔄 Restored original listing order after grading');
        }
        
        // Log which listings have grades
        const gradedListings = updatedData.listings.filter((l: Listing) => l.evaluation?.predictedGradeMin);
        console.log(`📈 Listings with grades: ${gradedListings.length}`, 
          gradedListings.map((l: Listing) => ({ id: l.id, title: l.title.substring(0, 50) }))
        );
        
        setSearchData(updatedData);
      }
    } catch (err) {
      console.error('Grading error:', err);
      setGradingStates(prev => ({
        ...prev,
        [listingId]: {
          isGrading: false,
          error: err instanceof Error ? err.message : 'Grading failed',
          progress: 0
        }
      }));
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mx-auto mb-4"></div>
        <p className="text-gray-600 text-lg">Loading search results...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8">
        <h3 className="text-red-800 font-bold text-xl mb-2">Error</h3>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!searchData) {
    return null;
  }

  const getGradeColor = (grade: number | null) => {
    if (!grade) return 'text-gray-500';
    if (grade >= 9) return 'text-green-600';
    if (grade >= 8) return 'text-blue-600';
    if (grade >= 7) return 'text-yellow-600';
    return 'text-orange-600';
  };

  const getGradeBadge = (min: number | null, max: number | null) => {
    if (!min || !max) return 'Unknown';
    if (min === max) return `PSA ${min}`;
    return `PSA ${min}-${max}`;
  };

  // Pagination calculations
  const totalPages = Math.ceil(searchData.listings.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentListings = searchData.listings.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">
            Search Results
          </h2>
          <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
            searchData.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
            searchData.status === 'PROCESSING' ? 'bg-blue-100 text-blue-800' :
            searchData.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>
            {searchData.status}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">Total Listings</p>
            <p className="text-3xl font-bold text-gray-900">{searchData.progress.total}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-blue-600">Processed</p>
            <p className="text-3xl font-bold text-blue-900">{searchData.progress.processed}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-green-600">Qualified Deals</p>
            <p className="text-3xl font-bold text-green-900">{searchData.progress.qualified}</p>
          </div>
        </div>
      </div>

      {/* Listings */}
      {searchData.listings.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
          <p className="text-gray-500 text-lg">No listings found yet. Search is {searchData.status.toLowerCase()}...</p>
          <p className="text-gray-400 mt-2">Results will appear here as they are fetched</p>
        </div>
      ) : (
        <>
          {/* Pagination Info */}
          <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
              <span className="font-semibold">{Math.min(endIndex, searchData.listings.length)}</span> of{' '}
              <span className="font-semibold">{searchData.listings.length}</span> results
            </p>
            <p className="text-sm text-gray-500">
              Page {currentPage} of {totalPages}
            </p>
          </div>

          <div className="space-y-4">
            {currentListings.map((listing) => {
              const gradingState = gradingStates[listing.id];
              const isGrading = gradingState?.isGrading || false;
              const gradingError = gradingState?.error;

              return (
                <div
                  key={listing.id}
                  className="bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow overflow-hidden"
                >
                  <div className="flex">
                    {/* Image */}
                    <div className="w-48 h-48 bg-gray-200 flex-shrink-0">
                      {listing.images && listing.images.length > 0 ? (
                        <img
                          src={listing.images[0]}
                          alt={listing.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          No Image
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 pr-4">
                          <h3 className="text-lg font-bold text-gray-900 mb-2 hover:text-indigo-600">
                            <a href={listing.url} target="_blank" rel="noopener noreferrer">
                              {listing.title}
                            </a>
                          </h3>
                          <p className="text-sm text-gray-600">
                            Condition: <span className="font-medium">{listing.condition}</span>
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-3xl font-bold text-indigo-600">
                            ${listing.price.toFixed(2)}
                          </p>
                          {listing.shippingCost > 0 && (
                            <p className="text-sm text-gray-500">
                              +${listing.shippingCost.toFixed(2)} shipping
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Grading Status / Results */}
                      {isGrading ? (
                        <div className="bg-blue-50 rounded-lg p-4 mt-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-blue-900">🤖 AI Grading in Progress...</p>
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                          </div>
                          <div className="w-full bg-blue-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full transition-all duration-500 animate-pulse"
                              style={{ width: '60%' }}
                            ></div>
                          </div>
                          <p className="text-xs text-blue-600 mt-2">Analyzing card images with OpenAI Vision...</p>
                        </div>
                      ) : gradingError ? (
                        <div className="bg-red-50 rounded-lg p-4 mt-4 border border-red-200">
                          <p className="text-sm font-medium text-red-900 mb-2">❌ Grading Failed</p>
                          <p className="text-xs text-red-700">{gradingError}</p>
                          <button
                            onClick={() => gradeListingOnDemand(listing.id)}
                            className="mt-3 text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors"
                          >
                            Retry Grading
                          </button>
                        </div>
                      ) : listing.evaluation?.predictedGradeMin ? (
                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-4 mt-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-xs text-gray-600 mb-1">Predicted Grade</p>
                              <p className={`text-lg font-bold ${getGradeColor(listing.evaluation.predictedGradeMin)}`}>
                                {getGradeBadge(listing.evaluation.predictedGradeMin, listing.evaluation.predictedGradeMax)}
                              </p>
                              <p className="text-xs text-gray-500">
                                {(listing.evaluation.gradeConfidence * 100).toFixed(0)}% confidence
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-gray-600 mb-1">Expected Value</p>
                              <p className="text-lg font-bold text-green-600">
                                ${listing.evaluation.expectedValue.toFixed(2)}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-gray-600 mb-1">Deal Margin</p>
                              <p className={`text-lg font-bold ${
                                listing.evaluation.dealMargin > 50 ? 'text-green-600' :
                                listing.evaluation.dealMargin > 0 ? 'text-blue-600' :
                                'text-red-600'
                              }`}>
                                ${listing.evaluation.dealMargin.toFixed(2)}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-gray-600 mb-1">Deal Score</p>
                              <div className="flex items-center">
                                <p className="text-lg font-bold text-indigo-600 mr-2">
                                  {listing.evaluation.dealScore.toFixed(1)}
                                </p>
                                {listing.evaluation.isQualified && (
                                  <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-semibold">
                                    ✓ Qualified
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {listing.evaluation.cardName && (
                            <div className="mt-3 pt-3 border-t border-indigo-200">
                              <p className="text-sm text-gray-700">
                                <span className="font-medium">Identified as:</span>{' '}
                                {listing.evaluation.cardName}
                                {listing.evaluation.cardSet && ` • ${listing.evaluation.cardSet}`}
                                {listing.evaluation.cardNumber && ` #${listing.evaluation.cardNumber}`}
                              </p>
                            </div>
                          )}

                          {listing.evaluation.qualificationFlags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {listing.evaluation.qualificationFlags.map((flag, idx) => (
                                <span key={idx} className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                                  ⚠️ {flag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded-lg p-4 mt-4 text-center">
                          <p className="text-sm text-gray-500 mb-3">
                            🤖 AI Grading Available
                          </p>
                          <button
                            onClick={() => gradeListingOnDemand(listing.id)}
                            className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-sm"
                          >
                            Grade This Card
                          </button>
                        </div>
                      )}

                      {/* Seller Info */}
                      <div className="mt-4 flex items-center justify-between text-sm">
                        <div>
                          <span className="text-gray-600">Seller:</span>{' '}
                          <span className="font-medium text-gray-900">{listing.seller.username}</span>
                          <span className="text-gray-500 ml-2">
                            ({listing.seller.feedbackScore} • {listing.seller.feedbackPercent.toFixed(1)}%)
                          </span>
                        </div>
                        <a
                          href={listing.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                        >
                          View on eBay →
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="bg-white rounded-lg shadow-lg p-6 flex items-center justify-center gap-2">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                ← Previous
              </button>

              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  const showPage =
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 2 && page <= currentPage + 2);

                  if (!showPage) {
                    if (page === currentPage - 3 || page === currentPage + 3) {
                      return (
                        <span key={page} className="px-3 py-2 text-gray-400">
                          ...
                        </span>
                      );
                    }
                    return null;
                  }

                  return (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        currentPage === page
                          ? 'bg-indigo-600 text-white'
                          : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
