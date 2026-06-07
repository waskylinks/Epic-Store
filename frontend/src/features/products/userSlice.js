import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

axios.defaults.withCredentials = true;


const SERVER_SESSION_KEY = 'epic_session';

const syncServerSessionId = (sessionId) => {
  if (!sessionId) return;
  try {
    localStorage.setItem(SERVER_SESSION_KEY, JSON.stringify({
      id:        sessionId,
      lastSeen:  Date.now(),
      startedAt: new Date().toISOString(),
    }));
  } catch {
    // localStorage unavailable (private browsing quota exceeded, etc.) — non-fatal
  }
};

// REGISTER
export const register = createAsyncThunk(
  "user/register",
  async (userData, { rejectWithValue }) => {
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const { data } = await axios.post("/api/v1/register", userData, config);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Registration failed. Try again later." }
      );
    }
  }
);

// LOGIN
export const login = createAsyncThunk(
  "user/login",
  async ({ email, password }, { rejectWithValue }) => {
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const { data } = await axios.post("/api/v1/login", { email, password }, config);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Login failed. Try again later." }
      );
    }
  }
);

// LOAD USER
export const loadUser = createAsyncThunk(
  "user/loadUser",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.get("/api/v1/profile");
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to load user." }
      );
    }
  }
);

// LOGOUT
// NOTE: cartSlice listens to logout.fulfilled and logout.rejected via cross-slice
// extraReducers to clear localStorage immediately on any logout outcome.
export const logout = createAsyncThunk(
  "user/logout",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/logout");
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Logout failed. Try again later." }
      );
    }
  }
);

// VERIFY EMAIL

export const verifyEmail = createAsyncThunk(
  "user/verifyEmail",
  async ({ email, code }, { rejectWithValue }) => {
    try {
      const { getMetaPixelCookies, getGA4ClientId, getAttributionContext } =
        await import('../../utils/analytics.js');

      const metaCookies = getMetaPixelCookies();
      const ga4ClientId = getGA4ClientId();
      const attribution = getAttributionContext();

      const { data } = await axios.post(
        "/api/v1/verify-email",
        {
          email,
          code,
          fbp:              metaCookies.fbp  || null,
          fbc:              metaCookies.fbc  || null,
          ga4ClientId:      ga4ClientId      || null,
          clientAttribution: attribution,
          clientTimestamp:  new Date().toISOString(),
        },
        { headers: { "Content-Type": "application/json" } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Email verification failed." }
      );
    }
  }
);

// RESEND VERIFICATION CODE
export const resendVerificationCode = createAsyncThunk(
  "user/resendVerification",
  async (email, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/resend-verification",
        { email },
        { headers: { "Content-Type": "application/json" } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Failed to resend code." }
      );
    }
  }
);

// UPDATE PROFILE
// NOTE: Server syncs customer analytics after every profile update
export const updateProfile = createAsyncThunk(
  "user/updateProfile",
  async (userData, { rejectWithValue }) => {
    try {
      let profileData = {};

      if (userData instanceof FormData) {
        const name   = userData.get('name');
        const email  = userData.get('email');
        const avatar = userData.get('avatar');

        if (name) {
          const nameParts       = name.trim().split(' ');
          profileData.firstName = nameParts[0] || '';
          profileData.lastName  = nameParts.slice(1).join(' ') || nameParts[0] || '';
        }
        if (email)                   profileData.email  = email;
        if (avatar && avatar !== '') profileData.avatar = avatar;
      } else {
        profileData = userData;
      }

      const config = { headers: { "Content-Type": "application/json" } };
      const { data } = await axios.put("/api/v1/profile/update", profileData, config);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Profile update failed." }
      );
    }
  }
);

// UPDATE PASSWORD
export const updatePassword = createAsyncThunk(
  "user/updatePassword",
  async (formData, { rejectWithValue }) => {
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const { data } = await axios.put("/api/v1/password/update", formData, config);
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Password update failed." }
      );
    }
  }
);

// FORGOT PASSWORD (Request Reset Code)
export const forgotPassword = createAsyncThunk(
  "user/forgotPassword",
  async (email, { rejectWithValue }) => {
    try {
      const { data } = await axios.post("/api/v1/password/forgot", { email });
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Forgot password failed." }
      );
    }
  }
);

// VERIFY RESET CODE (Step 2 of password reset)
export const verifyResetCode = createAsyncThunk(
  "user/verifyResetCode",
  async ({ email, code }, { rejectWithValue }) => {
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const { data } = await axios.post(
        "/api/v1/password/verify-code",
        { email, code },
        config
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Code verification failed." }
      );
    }
  }
);

// RESET PASSWORD WITH CODE (Step 3 of password reset)
export const resetPassword = createAsyncThunk(
  "user/resetPassword",
  async ({ email, code, password, confirmPassword }, { rejectWithValue }) => {
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const { data } = await axios.post(
        "/api/v1/password/reset",
        { email, code, password, confirmPassword },
        config
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || { message: "Password reset failed." }
      );
    }
  }
);

// ======================= SLICE =======================
const userSlice = createSlice({
  name: "user",
  initialState: {
    user:              null,
    loading:           false,
    error:             null,
    success:           false,
    message:           null,
    isAuthenticated:   false,
    needsVerification: false,
    verificationEmail: null,
    initializing:      true,
    codeVerified:      false,
    // analyticsReady is intentionally NOT tracked here.
    // syncCustomerAnalytics runs server-side inside verifyEmail and updateProfile.
  },
  reducers: {
    removeErrors: (state) => {
      state.error = null;
    },
    removeSuccess: (state) => {
      state.success = false;
      state.message = null;
    },
    clearVerificationState: (state) => {
      state.needsVerification = false;
      state.verificationEmail = null;
    },
    clearCodeVerifiedState: (state) => {
      state.codeVerified = false;
    },
    // Hydrates Redux user state synchronously from an already-received API response.
    // Used by RecoverCart to avoid a second HTTP round-trip after cart recovery,
    // which would race against the browser committing the Set-Cookie header.
    setUser: (state, action) => {
      state.user            = action.payload || null;
      state.isAuthenticated = Boolean(action.payload);
      state.loading         = false;
    },
  },
  extraReducers: (builder) => {

    // REGISTER
    builder
      .addCase(register.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(register.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
        if (action.payload.needsVerification) {
          state.needsVerification = true;
          state.verificationEmail = action.payload.email;
        }
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message || "Registration failed.";
      });

    // LOGIN
    builder
      .addCase(login.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(login.fulfilled, (state, action) => {
        state.loading           = false;
        state.success           = action.payload.success;
        state.user              = action.payload.user || null;
        state.isAuthenticated   = Boolean(action.payload.user);
        state.needsVerification = false;
        state.verificationEmail = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading         = false;
        state.error           = action.payload?.message || "Login failed.";
        state.user            = null;
        state.isAuthenticated = false;
        if (action.payload?.needsVerification) {
          state.needsVerification = true;
          state.verificationEmail = action.payload.email;
        }
      });

    // LOAD USER
    // FIX (session ID collision): on success, write the server's sessionId
    // into localStorage so getOrCreateSessionId() returns the same value
    // that req.sessionId carries on every backend request. Without this,
    // browser analytics events and server order events use two different
    // session ID values and BigQuery session joins produce zero rows.
    builder
      .addCase(loadUser.pending,   (state) => { state.loading = true; })
      .addCase(loadUser.fulfilled, (state, action) => {
        state.loading         = false;
        state.user            = action.payload.user || null;
        state.isAuthenticated = Boolean(action.payload.user);
        state.initializing    = false;

        // Sync server session ID to localStorage — runs outside the Redux
        // state update since localStorage is a side effect, not Redux state.
        syncServerSessionId(action.payload.sessionId);
      })
      .addCase(loadUser.rejected, (state) => {
        state.loading         = false;
        state.user            = null;
        state.isAuthenticated = false;
        state.initializing    = false;
      });

    // LOGOUT
    builder
      .addCase(logout.pending,   (state) => { state.loading = true; })
      .addCase(logout.fulfilled, (state) => {
        state.loading         = false;
        state.user            = null;
        state.isAuthenticated = false;
      })
      .addCase(logout.rejected, (state, action) => {
        // Still log the user out client-side even if the server call fails.
        state.loading         = false;
        state.user            = null;
        state.isAuthenticated = false;
        state.error           = action.payload?.message;
      });

    // VERIFY EMAIL
    builder
      .addCase(verifyEmail.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(verifyEmail.fulfilled, (state, action) => {
        state.loading           = false;
        state.user              = action.payload.user || null;
        state.isAuthenticated   = Boolean(action.payload.user);
        state.success           = true;
        state.needsVerification = false;
        state.verificationEmail = null;
      })
      .addCase(verifyEmail.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message;
      });

    // RESEND VERIFICATION CODE
    builder
      .addCase(resendVerificationCode.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(resendVerificationCode.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload.message;
      })
      .addCase(resendVerificationCode.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message;
      });

    // UPDATE PROFILE
    builder
      .addCase(updateProfile.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.loading  = false;
        state.user     = action.payload.user || state.user;
        state.success  = action.payload.success;
        state.message  = action.payload.message;
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message;
      });

    // UPDATE PASSWORD
    builder
      .addCase(updatePassword.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(updatePassword.fulfilled, (state, action) => {
        state.loading = false;
        state.success = action.payload?.success;
      })
      .addCase(updatePassword.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message;
      });

    // FORGOT PASSWORD
    builder
      .addCase(forgotPassword.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(forgotPassword.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.message = action.payload?.message;
      })
      .addCase(forgotPassword.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message;
      });

    // VERIFY RESET CODE
    builder
      .addCase(verifyResetCode.pending,   (state) => { state.loading = true; state.error = null; state.codeVerified = false; })
      .addCase(verifyResetCode.fulfilled, (state, action) => {
        state.loading      = false;
        state.success      = true;
        state.codeVerified = true;
        state.message      = action.payload?.message;
      })
      .addCase(verifyResetCode.rejected, (state, action) => {
        state.loading      = false;
        state.error        = action.payload?.message;
        state.codeVerified = false;
      });

    // RESET PASSWORD
    builder
      .addCase(resetPassword.pending,   (state) => { state.loading = true; state.error = null; })
      .addCase(resetPassword.fulfilled, (state, action) => {
        state.loading         = false;
        state.success         = true;
        state.user            = action.payload.user || null;
        state.isAuthenticated = Boolean(action.payload.user);
        state.codeVerified    = false;
      })
      .addCase(resetPassword.rejected, (state, action) => {
        state.loading = false;
        state.error   = action.payload?.message;
      });
  },
});

// ======================= EXPORTS =======================
export const {
  removeErrors,
  removeSuccess,
  clearVerificationState,
  clearCodeVerifiedState,
  setUser,
} = userSlice.actions;

export default userSlice.reducer;