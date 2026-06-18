// Redux Toolkit slice holding auth state (token presence + current user).
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { api, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from "@/api/client";
import type { AuthTokens, User } from "@/api/types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: Boolean(localStorage.getItem(ACCESS_TOKEN_KEY)),
  loading: false,
  error: null,
};

// Login: OAuth2 password flow expects form-encoded "username"/"password".
export const login = createAsyncThunk(
  "auth/login",
  async (creds: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const form = new URLSearchParams();
      form.append("username", creds.email);
      form.append("password", creds.password);
      const { data } = await api.post<AuthTokens>("/auth/login", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      const me = await api.get<User>("/auth/me");
      return me.data;
    } catch {
      return rejectWithValue("Email ou mot de passe incorrect");
    }
  }
);

export const fetchMe = createAsyncThunk("auth/me", async () => {
  const { data } = await api.get<User>("/auth/me");
  return data;
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout(state) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      state.user = null;
      state.isAuthenticated = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<User>) => {
        state.loading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) ?? "Erreur de connexion";
      })
      .addCase(fetchMe.fulfilled, (state, action: PayloadAction<User>) => {
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(fetchMe.rejected, (state) => {
        state.isAuthenticated = false;
        state.user = null;
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
