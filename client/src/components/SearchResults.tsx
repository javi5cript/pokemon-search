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

interface GradingDetails {
  centering?: {
    frontHorizontal: string;
    frontVertical: string;
    backHorizontal?: string;
    backVertical?: string;
    assessment: string;
    impactOnGrade: string;
  };
  corners?: {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    assessment: string;
    impactOnGrade: string;
  };
  edges?: {
    top: string;
    right: string;
    bottom: string;
    left: string;
    assessment: string;
    impactOnGrade: string;
  };
  surface?: {
    frontCondition: string;
    backCondition?: string;
    defects: string[];
    assessment: string;
    impactOnGrade: string;
  };
  imageQuality?: {
    adequateForGrading: boolean;
    missingViews: string[];
    photoQualityIssues: string[];
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
    gradeReasoning?: string;
    gradingDetails?: GradingDetails;
    defectFlags?: string[];
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
  const [expandedGrading, setExpandedGrading] = useState<{ [key: string]: boolean }>({});
  const [currentImageIndex, setCurrentImageIndex] = useState<{ [key: string]: number }>({});
  const [showImageSelector, setShowImageSelector] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<{ front?: number; back?: number }>({});
  const itemsPerPage = 25;

  const toggleGradingDetails = (listingId: string) => {
    setExpandedGrading(prev => ({
      ...prev,
      [listingId]: !prev[listingId]
    }));
  };

  const nextImage = (listingId: string, totalImages: number) => {
    setCurrentImageIndex(prev => ({
      ...prev,
      [listingId]: ((prev[listingId] || 0) + 1) % totalImages
    }));
  };

  const previousImage = (listingId: string, totalImages: number) => {
    setCurrentImageIndex(prev => ({
      ...prev,
      [listingId]: ((prev[listingId] || 0) - 1 + totalImages) % totalImages
    }));
  };

  const goToImage = (listingId: string, index: number) => {
    setCurrentImageIndex(prev => ({
      ...prev,
      [listingId]: index
    }));
  };

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

  // Get the current listing for the image selector
  const currentListing = showImageSelector 
    ? searchData.listings.find(l => l.id === showImageSelector)
    : null;

  const handleStartGrading = async () => {
    if (!showImageSelector || selectedImages.front === undefined) return;
    
    const listing = searchData.listings.find(l => l.id === showImageSelector);
    if (!listing) return;

    // Close modal
    setShowImageSelector(null);
    
    // Start grading with selected images
    setGradingStates(prev => ({
      ...prev,
      [showImageSelector]: { isGrading: true, error: null, progress: 0 }
    }));

    try {
      const frontImageUrl = listing.images[selectedImages.front];
      const backImageUrl = selectedImages.back !== undefined ? listing.images[selectedImages.back] : undefined;

      const response = await fetch(
        `http://localhost:3001/api/search/${searchId}/listing/${showImageSelector}/grade`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frontImageUrl,
            backImageUrl
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Grading failed');
      }

      const result = await response.json();
      console.log(`✅ Grading completed:`, result);

      setGradingStates(prev => ({
        ...prev,
        [showImageSelector]: { isGrading: false, error: null, progress: 100 }
      }));

      // Refresh data
      const searchResponse = await fetch(`http://localhost:3001/api/search/${searchId}`);
      if (searchResponse.ok) {
        const updatedData = await searchResponse.json();
        if (originalOrder.length > 0) {
          const orderedListings = [...updatedData.listings].sort((a, b) => {
            const indexA = originalOrder.indexOf(a.id);
            const indexB = originalOrder.indexOf(b.id);
            return indexA - indexB;
          });
          updatedData.listings = orderedListings;
        }
        setSearchData(updatedData);
      }
    } catch (err) {
      console.error('Grading error:', err);
      setGradingStates(prev => ({
        ...prev,
        [showImageSelector]: {
          isGrading: false,
          error: err instanceof Error ? err.message : 'Grading failed',
          progress: 0
        }
      }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Image Selector Modal */}
      {showImageSelector && currentListing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold text-gray-900">Select Images for Grading</h3>
                <button
                  onClick={() => setShowImageSelector(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Choose which images to use for the front and back of the card. The AI will analyze these to determine the grade.
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Front Image Selection */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">📸 Front Image (Required)</h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {currentListing.images.map((image, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImages(prev => ({ ...prev, front: idx }))}
                      className={`relative aspect-square rounded-lg overflow-hidden border-4 transition-all ${
                        selectedImages.front === idx
                          ? 'border-blue-500 ring-4 ring-blue-200'
                          : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <img src={image} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                      {selectedImages.front === idx && (
                        <div className="absolute top-1 right-1 bg-blue-500 text-white rounded-full p-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs py-1 text-center">
                        #{idx + 1}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Back Image Selection */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">📸 Back Image (Optional)</h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  <button
                    onClick={() => setSelectedImages(prev => ({ ...prev, back: undefined }))}
                    className={`relative aspect-square rounded-lg overflow-hidden border-4 transition-all flex items-center justify-center ${
                      selectedImages.back === undefined
                        ? 'border-gray-400 ring-4 ring-gray-200 bg-gray-100'
                        : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                    }`}
                  >
                    <div className="text-center">
                      <svg className="w-8 h-8 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <p className="text-xs text-gray-500 mt-1">None</p>
                    </div>
                    {selectedImages.back === undefined && (
                      <div className="absolute top-1 right-1 bg-gray-500 text-white rounded-full p-1">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                  {currentListing.images.map((image, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImages(prev => ({ ...prev, back: idx }))}
                      className={`relative aspect-square rounded-lg overflow-hidden border-4 transition-all ${
                        selectedImages.back === idx
                          ? 'border-green-500 ring-4 ring-green-200'
                          : 'border-gray-200 hover:border-green-300'
                      }`}
                    >
                      <img src={image} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                      {selectedImages.back === idx && (
                        <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full p-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs py-1 text-center">
                        #{idx + 1}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="text-sm text-gray-600">
                <span className="font-medium">Selected:</span>{' '}
                Front #{selectedImages.front !== undefined ? selectedImages.front + 1 : '?'}
                {selectedImages.back !== undefined && `, Back #${selectedImages.back + 1}`}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowImageSelector(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartGrading}
                  disabled={selectedImages.front === undefined}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Grading →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                    {/* Image Carousel */}
                    <div className="w-48 h-48 bg-gray-200 flex-shrink-0 relative group">
                      {listing.images && listing.images.length > 0 ? (
                        <>
                          <img
                            src={listing.images[currentImageIndex[listing.id] || 0]}
                            alt={`${listing.title} - Image ${(currentImageIndex[listing.id] || 0) + 1}`}
                            className="w-full h-full object-cover"
                          />
                          
                          {/* Image Counter */}
                          <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                            {(currentImageIndex[listing.id] || 0) + 1} / {listing.images.length}
                          </div>

                          {/* Navigation Arrows - Show on hover if multiple images */}
                          {listing.images.length > 1 && (
                            <>
                              <button
                                onClick={() => previousImage(listing.id, listing.images.length)}
                                className="absolute left-1 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-75 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Previous image"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                              </button>
                              
                              <button
                                onClick={() => nextImage(listing.id, listing.images.length)}
                                className="absolute right-1 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-75 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Next image"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>

                              {/* Dot Indicators */}
                              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                {listing.images.map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => goToImage(listing.id, idx)}
                                    className={`w-2 h-2 rounded-full transition-all ${
                                      (currentImageIndex[listing.id] || 0) === idx
                                        ? 'bg-white w-3'
                                        : 'bg-white bg-opacity-50 hover:bg-opacity-75'
                                    }`}
                                    aria-label={`Go to image ${idx + 1}`}
                                  />
                                ))}
                              </div>
                            </>
                          )}
                        </>
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
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                              <p className="text-xs text-gray-600 mb-1">💎 Raw Price</p>
                              <p className="text-lg font-bold text-blue-600">
                                ${((listing.evaluation as any).rawPrice || 0).toFixed(2)}
                              </p>
                              <p className="text-xs text-gray-500">Ungraded</p>
                            </div>

                            <div>
                              <p className="text-xs text-gray-600 mb-1">🎯 Expected Value</p>
                              <p className="text-lg font-bold text-green-600">
                                ${listing.evaluation.expectedValue.toFixed(2)}
                              </p>
                              <p className="text-xs text-gray-500">
                                ${((listing.evaluation as any).expectedValueMin || 0).toFixed(0)} - ${((listing.evaluation as any).expectedValueMax || 0).toFixed(0)}
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

                          {/* Grading Details Toggle */}
                          {listing.evaluation.gradingDetails && (
                            <div className="mt-3 pt-3 border-t border-indigo-200">
                              <button
                                onClick={() => toggleGradingDetails(listing.id)}
                                className="w-full text-left text-sm font-medium text-indigo-700 hover:text-indigo-900 flex items-center justify-between"
                              >
                                <span>📋 {expandedGrading[listing.id] ? 'Hide' : 'View'} Detailed Grading Notes</span>
                                <span className="text-lg">{expandedGrading[listing.id] ? '▼' : '▶'}</span>
                              </button>

                              {expandedGrading[listing.id] && (
                                <div className="mt-3 space-y-3 text-sm">
                                  {/* Centering */}
                                  {listing.evaluation.gradingDetails.centering && (
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                      <h4 className="font-semibold text-indigo-900 mb-2">📐 Centering</h4>
                                      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                                        <div>
                                          <span className="text-gray-600">Front H:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.centering.frontHorizontal}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Front V:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.centering.frontVertical}</span>
                                        </div>
                                        {listing.evaluation.gradingDetails.centering.backHorizontal && (
                                          <div>
                                            <span className="text-gray-600">Back H:</span>{' '}
                                            <span className="font-medium">{listing.evaluation.gradingDetails.centering.backHorizontal}</span>
                                          </div>
                                        )}
                                        {listing.evaluation.gradingDetails.centering.backVertical && (
                                          <div>
                                            <span className="text-gray-600">Back V:</span>{' '}
                                            <span className="font-medium">{listing.evaluation.gradingDetails.centering.backVertical}</span>
                                          </div>
                                        )}
                                      </div>
                                      <p className="text-gray-700 text-xs mb-1">{listing.evaluation.gradingDetails.centering.assessment}</p>
                                      <p className="text-indigo-600 text-xs italic">{listing.evaluation.gradingDetails.centering.impactOnGrade}</p>
                                    </div>
                                  )}

                                  {/* Corners */}
                                  {listing.evaluation.gradingDetails.corners && (
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                      <h4 className="font-semibold text-indigo-900 mb-2">🔲 Corners</h4>
                                      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                                        <div>
                                          <span className="text-gray-600">Top Left:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.corners.topLeft}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Top Right:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.corners.topRight}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Bottom Left:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.corners.bottomLeft}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Bottom Right:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.corners.bottomRight}</span>
                                        </div>
                                      </div>
                                      <p className="text-gray-700 text-xs mb-1">{listing.evaluation.gradingDetails.corners.assessment}</p>
                                      <p className="text-indigo-600 text-xs italic">{listing.evaluation.gradingDetails.corners.impactOnGrade}</p>
                                    </div>
                                  )}

                                  {/* Edges */}
                                  {listing.evaluation.gradingDetails.edges && (
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                      <h4 className="font-semibold text-indigo-900 mb-2">📏 Edges</h4>
                                      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                                        <div>
                                          <span className="text-gray-600">Top:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.edges.top}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Right:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.edges.right}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Bottom:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.edges.bottom}</span>
                                        </div>
                                        <div>
                                          <span className="text-gray-600">Left:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.edges.left}</span>
                                        </div>
                                      </div>
                                      <p className="text-gray-700 text-xs mb-1">{listing.evaluation.gradingDetails.edges.assessment}</p>
                                      <p className="text-indigo-600 text-xs italic">{listing.evaluation.gradingDetails.edges.impactOnGrade}</p>
                                    </div>
                                  )}

                                  {/* Surface */}
                                  {listing.evaluation.gradingDetails.surface && (
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                      <h4 className="font-semibold text-indigo-900 mb-2">✨ Surface</h4>
                                      <div className="text-xs space-y-1 mb-2">
                                        <div>
                                          <span className="text-gray-600">Front:</span>{' '}
                                          <span className="font-medium">{listing.evaluation.gradingDetails.surface.frontCondition}</span>
                                        </div>
                                        {listing.evaluation.gradingDetails.surface.backCondition && (
                                          <div>
                                            <span className="text-gray-600">Back:</span>{' '}
                                            <span className="font-medium">{listing.evaluation.gradingDetails.surface.backCondition}</span>
                                          </div>
                                        )}
                                        {listing.evaluation.gradingDetails.surface.defects && listing.evaluation.gradingDetails.surface.defects.length > 0 && (
                                          <div>
                                            <span className="text-gray-600">Defects:</span>{' '}
                                            <span className="font-medium text-orange-600">{listing.evaluation.gradingDetails.surface.defects.join(', ')}</span>
                                          </div>
                                        )}
                                      </div>
                                      <p className="text-gray-700 text-xs mb-1">{listing.evaluation.gradingDetails.surface.assessment}</p>
                                      <p className="text-indigo-600 text-xs italic">{listing.evaluation.gradingDetails.surface.impactOnGrade}</p>
                                    </div>
                                  )}

                                  {/* Grading Reasoning */}
                                  {listing.evaluation.gradeReasoning && (
                                    <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                      <h4 className="font-semibold text-indigo-900 mb-2">🤔 AI Analysis</h4>
                                      <p className="text-gray-700 text-xs">{listing.evaluation.gradeReasoning}</p>
                                    </div>
                                  )}

                                  {/* Defect Flags */}
                                  {listing.evaluation.defectFlags && listing.evaluation.defectFlags.length > 0 && (
                                    <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                                      <h4 className="font-semibold text-orange-900 mb-2">⚠️ Noted Issues</h4>
                                      <div className="flex flex-wrap gap-1">
                                        {listing.evaluation.defectFlags.map((defect, idx) => (
                                          <span key={idx} className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded">
                                            {defect}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Image Quality */}
                                  {listing.evaluation.gradingDetails.imageQuality && (
                                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                      <h4 className="font-semibold text-gray-900 mb-2">📸 Image Quality Assessment</h4>
                                      <div className="text-xs space-y-1">
                                        <div>
                                          <span className="text-gray-600">Adequate for Grading:</span>{' '}
                                          <span className={`font-medium ${listing.evaluation.gradingDetails.imageQuality.adequateForGrading ? 'text-green-600' : 'text-red-600'}`}>
                                            {listing.evaluation.gradingDetails.imageQuality.adequateForGrading ? 'Yes ✓' : 'No ✗'}
                                          </span>
                                        </div>
                                        {listing.evaluation.gradingDetails.imageQuality.missingViews && listing.evaluation.gradingDetails.imageQuality.missingViews.length > 0 && (
                                          <div>
                                            <span className="text-gray-600">Missing Views:</span>{' '}
                                            <span className="text-orange-600">{listing.evaluation.gradingDetails.imageQuality.missingViews.join(', ')}</span>
                                          </div>
                                        )}
                                        {listing.evaluation.gradingDetails.imageQuality.photoQualityIssues && listing.evaluation.gradingDetails.imageQuality.photoQualityIssues.length > 0 && (
                                          <div>
                                            <span className="text-gray-600">Photo Issues:</span>{' '}
                                            <span className="text-orange-600">{listing.evaluation.gradingDetails.imageQuality.photoQualityIssues.join(', ')}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded-lg p-4 mt-4 text-center">
                          <p className="text-sm text-gray-500 mb-3">
                            🤖 AI Grading Available
                          </p>
                          <button
                            onClick={() => {
                              setShowImageSelector(listing.id);
                              setSelectedImages({ front: 0, back: listing.images.length > 1 ? 1 : undefined });
                            }}
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
