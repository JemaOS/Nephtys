import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface MessageSearchProps {
  messages: any[];
  onSearchResults: (results: any[]) => void;
  onClose: () => void;
}

export const MessageSearch: React.FC<MessageSearchProps> = ({
  messages,
  onSearchResults,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      onSearchResults([]);
      return;
    }

    // Recherche insensible à la casse
    const query = searchQuery.toLowerCase();
    const results = messages.filter(message =>
      message.content.toLowerCase().includes(query)
    );

    setSearchResults(results);
    onSearchResults(results);
  }, [searchQuery, messages]);

  const handleClose = () => {
    setSearchQuery('');
    setSearchResults([]);
    onSearchResults([]);
    onClose();
  };

  return (
    <div className="bg-glass-surface-light backdrop-blur-[30px] border-b border-glass-border p-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher dans la conversation..."
            className="w-full h-10 pl-10 pr-4 rounded-full bg-glass-surface-medium backdrop-blur-[20px] border border-glass-border text-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all duration-fast"
            autoFocus
          />
        </div>
        
        {searchQuery && (
          <div className="text-sm text-text-tertiary whitespace-nowrap">
            {searchResults.length} résultat{searchResults.length !== 1 ? 's' : ''}
          </div>
        )}
        
        <button
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-glass-surface-light backdrop-blur-[20px] border border-glass-border flex items-center justify-center hover:bg-white/10 transition-colors"
          aria-label="Fermer la recherche"
        >
          <X size={20} className="text-text-tertiary" />
        </button>
      </div>
    </div>
  );
};