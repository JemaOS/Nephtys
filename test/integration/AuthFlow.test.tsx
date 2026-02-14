import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthPage } from '../../src/pages/AuthPage';
import { AuthProvider } from '../../src/context/AuthContext';
import { BrowserRouter } from 'react-router-dom';

// Mock Supabase
const mockInvoke = vi.fn();
const mockSetSession = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();

// Helper function for maybeSingle mock
const createMaybeSingleMock = () => Promise.resolve({ data: null, error: null });

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: any[]) => mockInvoke(...args),
    },
    auth: {
      setSession: (...args: any[]) => mockSetSession(...args),
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
    },
    channel: () => ({
      on: () => ({
        subscribe: () => {},
      }),
    }),
    removeChannel: () => {},
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: createMaybeSingleMock,
        }),
      }),
    }),
  },
}));

// Mock usePresence hooks
vi.mock('../../src/hooks/usePresence', () => ({
  initializePresence: vi.fn(),
  cleanupPresence: vi.fn(),
}));

describe('AuthFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } });
  });

  const renderAuthPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider>
          <AuthPage />
        </AuthProvider>
      </BrowserRouter>
    );
  };

  it('should render login form by default', async () => {
    renderAuthPage();
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('votre_pseudo')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  });

  it('should switch to signup mode', async () => {
    renderAuthPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inscription' }));
    expect(screen.getByRole('heading', { name: 'Créer un compte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le compte' })).toBeInTheDocument();
  });

  it('should handle successful login', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        data: {
          session: {
            access_token: 'fake-token',
            refresh_token: 'fake-refresh-token',
            user: { id: 'user-123' },
          },
        },
      },
      error: null,
    });
    mockSetSession.mockResolvedValue({ error: null });

    renderAuthPage();

    fireEvent.change(screen.getByPlaceholderText('votre_pseudo'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
    
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('auth-with-username', {
        body: { action: 'signin', username: 'testuser', password: 'password123' },
      });
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'fake-token',
        refresh_token: 'fake-refresh-token',
      });
    });
  });

  it('should handle login error', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: { message: 'Invalid login credentials' } },
      error: null,
    });

    renderAuthPage();

    fireEvent.change(screen.getByPlaceholderText('votre_pseudo'), { target: { value: 'wronguser' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrongpass' } });
    
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Identifiants incorrects/i)).toBeInTheDocument();
    });
  });

  it('should handle guest login', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        data: {
          session: {
            access_token: 'guest-token',
            refresh_token: 'guest-refresh-token',
            user: { id: 'guest-123' },
          },
        },
      },
      error: null,
    });
    mockSetSession.mockResolvedValue({ error: null });

    renderAuthPage();
    
    await act(async () => {
      fireEvent.click(screen.getByText('Éphémère'));
    });
    
    expect(screen.getByText('Mode éphémère')).toBeInTheDocument();
    
    fireEvent.change(screen.getByPlaceholderText('votre_pseudo'), { target: { value: 'guestuser' } });
    
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Démarrer en mode éphémère' }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('auth-with-username', expect.objectContaining({
        body: expect.objectContaining({
          action: 'signup',
          display_name: 'guestuser',
          is_ephemeral: true,
        }),
      }));
    });
  });
});
