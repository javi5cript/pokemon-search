'use client';

import { useState } from 'react';
import SearchForm from '../components/SearchForm';
import SearchResults from '../components/SearchResults';

export default function Home() {
  const [searchId, setSearchId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchCreated = (id: string) => {
    setSearchId(id);
    setIsSearching(true);
  };

  const handleReset = () => {
    setSearchId(null);
    setIsSearching(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            🎴 Pokémon Card Finder
          </h1>
          <p className="text-xl text-gray-600">
            Find valuable Pokémon card deals on eBay with AI-powered grading
          </p>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto">
          {!isSearching ? (
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">
                Search for Cards
              </h2>
              <SearchForm onSearchCreated={handleSearchCreated} />
            </div>
          ) : searchId ? (
            <div>
              <button
                onClick={handleReset}
                className="mb-6 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
              >
                ← New Search
              </button>
              <SearchResults searchId={searchId} />
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-gray-500 text-sm">
          <p>Powered by eBay API • PriceCharting • OpenAI</p>
          <p className="mt-2">
            AI-powered card grading and market analysis
          </p>
        </div>
      </div>
    </main>
  );
}
