'use client';

import { useState } from 'react';

interface SearchFormProps {
  onSearchCreated: (searchId: string) => void;
}

export default function SearchForm({ onSearchCreated }: SearchFormProps) {
  const [formData, setFormData] = useState({
    keywords: '',
    listingType: 'all',
    minPrice: '',
    maxPrice: '',
    condition: [] as string[],
    language: 'English',
    minSellerFeedback: '100',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setValidationErrors({});

    // Client-side validation
    const errors: Record<string, string> = {};
    
    if (!formData.keywords.trim()) {
      errors.keywords = 'Search keywords are required';
    }
    
    if (formData.minPrice && formData.maxPrice) {
      const min = parseFloat(formData.minPrice);
      const max = parseFloat(formData.maxPrice);
      if (min > max) {
        errors.priceRange = 'Minimum price cannot be greater than maximum price';
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setIsSubmitting(false);
      return;
    }

    try {
      const searchPayload = {
        keywords: formData.keywords,
        listingType: formData.listingType,
        ...(formData.minPrice && { minPrice: parseFloat(formData.minPrice) }),
        ...(formData.maxPrice && { maxPrice: parseFloat(formData.maxPrice) }),
        ...(formData.condition.length > 0 && { condition: formData.condition }),
        language: formData.language,
        minSellerFeedback: parseInt(formData.minSellerFeedback),
      };

      const response = await fetch('http://localhost:3001/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchPayload),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle validation errors from server
        if (data.details && Array.isArray(data.details)) {
          const serverErrors: Record<string, string> = {};
          data.details.forEach((detail: any) => {
            const field = detail.path?.[0] || 'general';
            serverErrors[field] = detail.message;
          });
          setValidationErrors(serverErrors);
          setError('Please fix the validation errors below');
        } else {
          setError(data.message || data.error || 'Failed to create search. Check server logs for details.');
        }
        return;
      }

      onSearchCreated(data.searchId);
    } catch (err) {
      console.error('Search error:', err);
      setError(
        err instanceof Error 
          ? `${err.message}. Make sure the server is running on port 3001.` 
          : 'Connection error. Make sure the server is running on port 3001.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConditionChange = (condition: string) => {
    setFormData((prev) => ({
      ...prev,
      condition: prev.condition.includes(condition)
        ? prev.condition.filter((c) => c !== condition)
        : [...prev.condition, condition],
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Keywords */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Search Keywords *
        </label>
        <input
          type="text"
          required
          value={formData.keywords}
          onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
          placeholder="e.g., Charizard Base Set, Pikachu 1st Edition"
          className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 ${
            validationErrors.keywords ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {validationErrors.keywords && (
          <p className="mt-1 text-sm text-red-600">{validationErrors.keywords}</p>
        )}
        <p className="mt-1 text-sm text-gray-500">
          Enter card name, set, or specific details
        </p>
      </div>

      {/* Listing Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Listing Type
        </label>
        <select
          value={formData.listingType}
          onChange={(e) => setFormData({ ...formData, listingType: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900"
        >
          <option value="all">All Listings</option>
          <option value="buyItNow">Buy It Now Only</option>
          <option value="auction">Auctions Only</option>
        </select>
      </div>

      {/* Price Range */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Price ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={formData.minPrice}
            onChange={(e) => setFormData({ ...formData, minPrice: e.target.value })}
            placeholder="10.00"
            className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 ${
              validationErrors.priceRange ? 'border-red-500' : 'border-gray-300'
            }`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Max Price ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={formData.maxPrice}
            onChange={(e) => setFormData({ ...formData, maxPrice: e.target.value })}
            placeholder="500.00"
            className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 ${
              validationErrors.priceRange ? 'border-red-500' : 'border-gray-300'
            }`}
          />
        </div>
      </div>
      {validationErrors.priceRange && (
        <p className="mt-1 text-sm text-red-600">{validationErrors.priceRange}</p>
      )}

      {/* Condition */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Card Condition
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['New', 'Like New', 'Very Good', 'Good'].map((condition) => (
            <label key={condition} className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.condition.includes(condition)}
                onChange={() => handleConditionChange(condition)}
                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">{condition}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Language
        </label>
        <select
          value={formData.language}
          onChange={(e) => setFormData({ ...formData, language: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900"
        >
          <option value="English">English</option>
          <option value="Japanese">Japanese</option>
          <option value="Korean">Korean</option>
          <option value="Chinese">Chinese</option>
          <option value="German">German</option>
          <option value="French">French</option>
          <option value="Italian">Italian</option>
          <option value="Spanish">Spanish</option>
        </select>
      </div>

      {/* Seller Feedback */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Minimum Seller Feedback Score
        </label>
        <input
          type="number"
          min="0"
          value={formData.minSellerFeedback}
          onChange={(e) => setFormData({ ...formData, minSellerFeedback: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900"
        />
        <p className="mt-1 text-sm text-gray-500">
          Filter sellers by their feedback rating
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-red-400 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-medium">{error}</p>
              {Object.keys(validationErrors).length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {Object.entries(validationErrors).map(([field, message]) => (
                    <li key={field}>• {message}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-indigo-600 text-white py-4 px-6 rounded-lg font-semibold text-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-lg"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Searching eBay...
          </span>
        ) : (
          '🔍 Search for Cards'
        )}
      </button>

      <p className="text-center text-sm text-gray-500">
        Note: This demo searches a local database. Add eBay API keys to search live listings.
      </p>
    </form>
  );
}
