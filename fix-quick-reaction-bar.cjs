const fs = require('node:fs');
const path = require('node:path');

// Read the file
const filePath = path.join(__dirname, 'src', 'pages', 'ChatViewPageComponents.tsx');
const content = fs.readFileSync(filePath, 'utf8');

// Find and replace the !isOwn case reaction button
const oldReactionButton = `        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setQuickReactionBar({
              isOpen: true,
              position: { x: rect.left + rect.width / 2, y: rect.top },
              message,
            });
          }}
          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
          title="Réagir"
          aria-label="Réagir"
        >
          <Smile size={16} className="text-[#8696a0]" />
        </button>`;

const newReactionButton = `        <button
          onClick={(e) => {
            // Get the message content element to position the reaction bar on the right side
            const messageElement = document.querySelector(\`[data-message-id="\${message.id}"]\`);
            if (messageElement) {
              const rect = messageElement.getBoundingClientRect();
              setQuickReactionBar({
                isOpen: true,
                position: { x: rect.right - (320 / 2), y: rect.top - 60 }, // Center the bar relative to the right edge
                message,
              });
            } else {
              // Fallback to button position if message element not found
              const rect = e.currentTarget.getBoundingClientRect();
              setQuickReactionBar({
                isOpen: true,
                position: { x: rect.left + rect.width / 2, y: rect.top },
                message,
              });
            }
          }}
          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
          title="Réagir"
          aria-label="Réagir"
        >
          <Smile size={16} className="text-[#8696a0]" />
        </button>`;

// Find the !isOwn case block and replace the reaction button
const ownCasePattern = /if \(!isOwn && hoveredMessageId === message\.id && !isSelectionMode\) \{([\s\S]*?)return null/;
const match = content.match(ownCasePattern);

if (!match) {
  console.error('Could not find the !isOwn case block');
  process.exit(1);
}

const ownCaseBlock = match[1];
const updatedOwnCaseBlock = ownCaseBlock.replace(oldReactionButton, newReactionButton);
const updatedContent = content.replace(ownCaseBlock, updatedOwnCaseBlock);

// Write the updated content back to the file
fs.writeFileSync(filePath, updatedContent, 'utf8');

console.log('Quick reaction bar position fixed for received messages');
