import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  bankerToken: string | null;
  bankerUsername: string | null;
  bankerStateId: string | null;
  bankerIsAdmin: boolean;
  bankerRole: string | null;
  bankerRole2: string | null;
  bankerRoles: string[];
  playerId: number | null;
  sessionToken: string | null;
  playerUsername: string | null;
  playerStaffRole: string | null;
  playerStaffRole2: string | null;
  playerStaffRoles: string[];
  setBankerToken: (token: string | null) => void;
  setBankerSession: (token: string, username: string, isAdmin: boolean, role?: string, role2?: string | null, roles?: string[], stateId?: string | null) => void;
  setBankerStateId: (stateId: string | null) => void;
  setPlayerId: (id: number | null) => void;
  setSessionToken: (token: string | null) => void;
  setPlayerSession: (id: number, token: string, username?: string, staffRole?: string | null, staffRole2?: string | null, staffRoles?: string[]) => void;
  logoutBanker: () => void;
  logoutPlayer: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      bankerToken: null,
      bankerUsername: null,
      bankerStateId: null,
      bankerIsAdmin: false,
      bankerRole: null,
      bankerRole2: null,
      bankerRoles: [],
      playerId: null,
      sessionToken: null,
      playerUsername: null,
      playerStaffRole: null,
      playerStaffRole2: null,
      playerStaffRoles: [],
      setBankerToken: (token) => set({ bankerToken: token }),
      setBankerSession: (token, username, isAdmin, role, role2, roles, stateId) => {
        const fullRoles = roles && roles.length > 0 ? roles : [role, role2].filter(Boolean) as string[];
        set({
          bankerToken: token,
          bankerUsername: username,
          bankerStateId: stateId ?? null,
          bankerIsAdmin: isAdmin,
          bankerRole: fullRoles[0] ?? role ?? null,
          bankerRole2: fullRoles[1] ?? role2 ?? null,
          bankerRoles: fullRoles,
        });
      },
      setBankerStateId: (stateId) => set({ bankerStateId: stateId }),
      setPlayerId: (id) => set({ playerId: id }),
      setSessionToken: (token) => set({ sessionToken: token }),
      setPlayerSession: (id, token, username, staffRole, staffRole2, staffRoles) => {
        const roles: string[] = staffRoles && staffRoles.length > 0
          ? staffRoles
          : [staffRole, staffRole2].filter(Boolean) as string[];
        set({
          playerId: id,
          sessionToken: token,
          playerUsername: username ?? null,
          playerStaffRole: roles[0] ?? staffRole ?? null,
          playerStaffRole2: roles[1] ?? staffRole2 ?? null,
          playerStaffRoles: roles,
        });
      },
      logoutBanker: () => set({ bankerToken: null, bankerUsername: null, bankerStateId: null, bankerIsAdmin: false, bankerRole: null, bankerRole2: null, bankerRoles: [] }),
      logoutPlayer: () => set({ playerId: null, sessionToken: null, playerUsername: null, playerStaffRole: null, playerStaffRole2: null, playerStaffRoles: [] }),
    }),
    { name: 'casino-storage' }
  )
);
