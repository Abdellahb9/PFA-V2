// Redux auth slice backed by Supabase Auth.
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface AppUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "recruiter" | "viewer" | "candidate";
}

export const isStaff = (role?: AppUser["role"]) => role === "admin" || role === "recruiter";

interface AuthState {
  user: AppUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,
};

async function loadProfile(user: SupabaseUser): Promise<AppUser> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: profile?.full_name ?? user.email ?? null,
    role: (profile?.role ?? "candidate") as AppUser["role"],
  };
}

export const login = createAsyncThunk(
  "auth/login",
  async (creds: { email: string; password: string }, { rejectWithValue }) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (error || !data.user) return rejectWithValue("Email ou mot de passe incorrect");
    return await loadProfile(data.user);
  },
);

export const fetchMe = createAsyncThunk("auth/me", async (_, { rejectWithValue }) => {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return rejectWithValue("Aucune session");
  return await loadProfile(data.user);
});

export const logout = createAsyncThunk("auth/logout", async () => {
  // Always succeed: clear the local session even if the network sign-out fails.
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore — state is cleared regardless below */
  }
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    // Synchronous, instant logout of the UI (route guards react immediately);
    // the network signOut runs separately in the background.
    sessionCleared: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<AppUser>) => {
        state.loading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) ?? "Erreur de connexion";
      })
      .addCase(fetchMe.fulfilled, (state, action: PayloadAction<AppUser>) => {
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(fetchMe.rejected, (state) => {
        state.user = null;
        state.isAuthenticated = false;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.isAuthenticated = false;
      })
      .addCase(logout.rejected, (state) => {
        state.user = null;
        state.isAuthenticated = false;
      });
  },
});

export const { sessionCleared } = authSlice.actions;
export default authSlice.reducer;
