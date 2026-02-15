// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Skeleton components for message loading - provides instant visual feedback
// similar to WhatsApp/Telegram to prevent flickering

interface MessageSkeletonProps {
  isOwn: boolean
}

const MessageSkeleton: React.FC<MessageSkeletonProps> = ({ isOwn }) => (
  <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3 px-2`}>
    <div className={`max-w-[75%] rounded-2xl p-3 ${isOwn ? 'bg-[#787add]' : 'bg-bg-surface'}`}>
      {!isOwn && (
        <div className="h-4 w-24 bg-text-secondary/20 rounded mb-2 animate-pulse" />
      )}
      <div className="space-y-2">
        <div className="h-4 bg-text-secondary/20 rounded animate-pulse w-3/4" />
        <div className="h-4 bg-text-secondary/20 rounded animate-pulse w-1/2" />
      </div>
      <div className="flex justify-end mt-2">
        <div className="h-3 w-12 bg-text-secondary/20 rounded animate-pulse" />
      </div>
    </div>
  </div>
)

interface MessageListSkeletonProps {
  count?: number
}

export const MessageListSkeleton: React.FC<MessageListSkeletonProps> = ({ count = 10 }) => {
  // Generate skeleton messages with alternating alignment
  const skeletons = Array.from({ length: count }, (_, i) => ({
    id: i,
    isOwn: i % 3 === 0
  }))

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {skeletons.map((skeleton) => (
        <MessageSkeleton key={skeleton.id} isOwn={skeleton.isOwn} />
      ))}
    </div>
  )
}

export default MessageListSkeleton
