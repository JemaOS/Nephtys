import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatViewPage } from '../../src/pages/ChatViewPage';
import { AuthProvider } from '../../src/context/AuthContext';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { CallProvider } from '../../src/context/CallContext';
import { BrowserRouter } from 'react-router-dom';

// Mock Supabase
const mocks = vi.hoisted(() => {
  return {
    mockSelect: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockEq: vi.fn(),
    mockOrder: vi.fn(),
    mockLimit: vi.fn(),
    mockSingle: vi.fn(),
    mockMaybeSingle: vi.fn(),
    mockIn: vi.fn(),
    mockIs: vi.fn(),
    mockGt: vi.fn(),
    mockNeq: vi.fn(),
  };
});

vi.mock('../../src/lib/supabase', () => {
  const mockSupabase = {
    from: vi.fn(() => ({
      select: mocks.mockSelect,
      insert: mocks.mockInsert,
      update: mocks.mockUpdate,
      delete: vi.fn(() => ({ eq: vi.fn() })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://fake.url' } }),
      })),
    },
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-123' } } }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  };
  return { supabase: mockSupabase };
});

// Mock hooks
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ conversationId: 'conv-123' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../../src/hooks/usePresence', () => ({
  useUserPresence: () => ({ statusText: 'Online', isOnline: true }),
  initializePresence: vi.fn(),
  cleanupPresence: vi.fn(),
}));

vi.mock('../../src/hooks/useNotifications', () => ({
  useNotifications: () => ({
    permission: 'granted',
    requestPermission: vi.fn(),
    sendNotification: vi.fn(),
    subscribeToConversation: vi.fn(),
    unsubscribeFromConversation: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useMessageReactions', () => ({
  useMessageReactions: () => ({
    reactions: [],
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: '',
    },
  },
  Document: () => null,
  Page: () => null,
}));

// Mock react-pdf
vi.mock('react-pdf', () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: '',
    },
  },
  Document: () => null,
  Page: () => null,
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('MessageFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mocks
    mocks.mockSelect.mockReturnThis();
    mocks.mockEq.mockReturnThis();
    mocks.mockOrder.mockReturnThis();
    mocks.mockLimit.mockReturnThis();
    mocks.mockIs.mockReturnThis();
    mocks.mockIn.mockReturnThis();
    
    // Default responses
    mocks.mockSelect.mockReturnValue({
      eq: mocks.mockEq,
      in: mocks.mockIn,
    });
    
    mocks.mockEq.mockReturnValue({
      maybeSingle: mocks.mockMaybeSingle,
      order: mocks.mockOrder,
      is: mocks.mockIs,
      eq: mocks.mockEq, // for chaining multiple eqs
      gt: mocks.mockGt,
      neq: mocks.mockNeq,
    });

    mocks.mockGt.mockReturnValue({
      order: mocks.mockOrder,
    });

    mocks.mockNeq.mockReturnValue({
      maybeSingle: mocks.mockMaybeSingle,
      order: mocks.mockOrder,
    });

    mocks.mockIs.mockReturnValue({
      order: mocks.mockOrder,
    });

    mocks.mockOrder.mockReturnValue({
      limit: mocks.mockLimit,
      maybeSingle: mocks.mockMaybeSingle,
    });

    mocks.mockLimit.mockReturnValue({
      maybeSingle: mocks.mockMaybeSingle,
    });
    
    mocks.mockMaybeSingle.mockResolvedValue({ data: { id: 'conv-123', type: 'direct' }, error: null });
    
    mocks.mockInsert.mockReturnValue({
      select: mocks.mockSelect,
    });
    mocks.mockUpdate.mockReturnValue({
      eq: mocks.mockEq,
    });
  });

  const renderChatPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            <CallProvider>
              <ChatViewPage />
            </CallProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    );
  };

  it('should render chat interface', async () => {
    renderChatPage();
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Taper un message')).toBeInTheDocument();
    });
  });

  it('should send a text message', async () => {
    renderChatPage();

    const input = await screen.findByPlaceholderText('Taper un message');
    fireEvent.change(input, { target: { value: 'Hello World' } });
    
    // Find the submit button
    const sendButton = document.querySelector('button[type="submit"]');
    if (sendButton) {
      fireEvent.click(sendButton);
    } else {
      // Fallback to form submission
      const form = input.closest('form');
      if (form) {
          fireEvent.submit(form);
      }
    }

    await waitFor(() => {
      expect(mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Hello World',
        conversation_id: 'conv-123',
        sender_id: 'user-123',
        type: 'text',
      }));
    });
  });

  it('should display messages', async () => {
    // Mock messages data for display - stored in variable for potential future use
    const mockMessages = [
      {
        id: 'msg-1',
        content: 'Hello there',
        sender_id: 'user-123', // Own message
        created_at: new Date().toISOString(),
        type: 'text',
        status: 'sent',
      },
      {
        id: 'msg-2',
        content: 'Hi!',
        sender_id: 'other-user', // Other user message
        created_at: new Date().toISOString(),
        type: 'text',
        status: 'read',
      },
    ];
    // Use mockMessages to set up the mock response
    mocks.mockMaybeSingle.mockResolvedValue({ data: mockMessages[0], error: null });

    // Mock messages query
    mocks.mockLimit.mockReturnValue({
      maybeSingle: mocks.mockMaybeSingle,
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByText('Hello there')).toBeInTheDocument();
      expect(screen.getByText('Hi!')).toBeInTheDocument();
    });
  });
});
