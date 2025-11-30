import React from 'react';

interface Reaction {
  id: string;
  emoji: string;
  user_id: string;
  count?: number;
  users?: string[]; // Liste des user_ids qui ont réagi
}

interface MessageReactionsProps {
  reactions: Reaction[];
  currentUserId: string;
  onReactionClick: (emoji: string) => void;
  onReactionRemove: (emoji: string) => void;
}

export const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions,
  currentUserId,
  onReactionClick,
  onReactionRemove,
}) => {
  if (!reactions || reactions.length === 0) {
    return null;
  }

  // Grouper les réactions par emoji
  const groupedReactions = reactions.reduce((acc, reaction) => {
    const existing = acc.find(r => r.emoji === reaction.emoji);
    if (existing) {
      existing.count = (existing.count || 0) + 1;
      existing.users = [...(existing.users || []), reaction.user_id];
    } else {
      acc.push({
        ...reaction,
        count: 1,
        users: [reaction.user_id],
      });
    }
    return acc;
  }, [] as Reaction[]);

  const handleReactionClick = (emoji: string, users: string[] = []) => {
    // Si l'utilisateur a déjà réagi avec cet emoji, on le retire
    if (users.includes(currentUserId)) {
      onReactionRemove(emoji);
    } else {
      // Sinon, on ajoute la réaction
      onReactionClick(emoji);
    }
  };

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {groupedReactions.map((reaction) => {
        const hasReacted = reaction.users?.includes(currentUserId);
        
        return (
          <button
            key={reaction.id}
            onClick={() => handleReactionClick(reaction.emoji, reaction.users)}
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm
              transition-all hover:scale-105 active:scale-95
              ${hasReacted 
                ? 'bg-accent/30 border border-accent/50' 
                : 'bg-white/10 border border-white/20 hover:bg-white/20'
              }
            `}
            type="button"
            aria-label={`${reaction.emoji} reaction (${reaction.count})`}
          >
            <span className="text-base leading-none">{reaction.emoji}</span>
            {reaction.count && reaction.count > 1 && (
              <span className={`text-xs font-medium ${hasReacted ? 'text-accent' : 'text-gray-300'}`}>
                {reaction.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};