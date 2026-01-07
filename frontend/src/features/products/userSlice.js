import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

axios.defaults.withCredentials = true;


// REGISTER API

export const register = createAsyncThunk('user/register', async(userData, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'multipart/form-data'
            }   
        };
        const {data} = await axios.post('/api/v1/register', userData, config);
        return data;

    } catch(error) {
        return rejectWithValue(error.response?.data || {message: `Registration failed. Please try again later`});
    }
});


// VERIFY EMAIL API

export const verifyEmail = createAsyncThunk('user/verifyEmail', async({email, code}, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'application/json'
            }   
        };
        const {data} = await axios.post('/api/v1/verify-email', {email, code}, config);
        return data;

    } catch(error) {
        return rejectWithValue(error.response?.data || {message: `Verification failed. Please try again later`});
    }
});


// RESEND VERIFICATION CODE API

export const resendVerificationCode = createAsyncThunk('user/resendVerification', async(email, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'application/json'
            }   
        };
        const {data} = await axios.post('/api/v1/resend-verification', {email}, config);
        return data;

    } catch(error) {
        return rejectWithValue(error.response?.data || {message: `Failed to resend code. Please try again later`});
    }
});


// LOGIN API

export const login = createAsyncThunk('user/login', async({email, password}, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'application/json'
            }   
        };
        const {data} = await axios.post('/api/v1/login', {email, password}, config);
        return data;

    } catch(error) {
        return rejectWithValue(error.response?.data || {message: `Login failed. Please try again later`});
    }
});


// LOAD USER

export const loadUser = createAsyncThunk('user/loadUser', async(_, {rejectWithValue}) => {
    try{
        const {data} = await axios.get('/api/v1/profile');
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data || {message: `Failed to load user. Please try again later`});
    }
});


// LOGOUT USER

export const logout = createAsyncThunk('user/logout', async(_, {rejectWithValue}) => {
    try{
        const {data} = await axios.post('/api/v1/logout', {}, {
            withCredentials : true
        });

        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data || {message: `Logout failed. Please try again later`});
    }
});


// UPDATE USER PROFILE

export const updateProfile = createAsyncThunk('user/updateProfile', async(userData, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'multipart/form-data'
            }
        };
        const {data} = await axios.put('/api/v1/profile/update', userData, config);
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data || {message: `Profile update failed. Please try again later`});
    }
});


// UPDATE USER PASSWORD

export const updatePassword = createAsyncThunk('user/updatePassword', async(formData, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'application/json'
            }
        };
        const {data} = await axios.put('/api/v1/password/update', formData, config);
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data || {message: `Password update failed. Please try again later`});
    }
});


// FORGOT USER PASSWORD

export const forgotPassword = createAsyncThunk(
  "user/forgotPassword",
  async (email, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        "/api/v1/password/forgot",
        { email }
      );
      return data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data || {
          message: "Forgot password request failed"
        }
      );
    }
  }
);


// RESET USER PASSWORD WITH CODE

export const resetPassword = createAsyncThunk('user/resetPassword', async({email, code, password, confirmPassword}, {rejectWithValue}) => {
    try{
        const config = {
            headers : {
                'Content-Type' : 'application/json'
            }
        };
        const {data} = await axios.post('/api/v1/password/reset', {email, code, password, confirmPassword}, config);
        return data;

    } catch (error) {
        return rejectWithValue(error.response?.data || {message: `Password reset failed. Please try again later`});
    }
});


// USER SLICE

const userSlice = createSlice({
    name: 'user',
    initialState: {
        user: null,
        loading: false,
        error: null,
        success: false,
        isAuthenticated: false,
        message: null,
        initializing: true,
        // New states for email verification
        needsVerification: false,
        verificationEmail: null,
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
        }
    },

    extraReducers: (builder) => {
        
        // REGISTRATION CASES
        
        builder
            .addCase(register.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(register.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = true;
                state.message = action.payload.message;
                // Store email for verification
                if (action.payload.needsVerification) {
                    state.needsVerification = true;
                    state.verificationEmail = action.payload.email;
                }
            })
            .addCase(register.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Registration failed. Please try again later';
                state.user = null;
                state.isAuthenticated = false;
            })

        
        // EMAIL VERIFICATION CASES
        
            .addCase(verifyEmail.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(verifyEmail.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = true;
                state.user = action.payload.user || null;
                state.isAuthenticated = Boolean(action.payload?.user);
                state.needsVerification = false;
                state.verificationEmail = null;
            })
            .addCase(verifyEmail.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Verification failed. Please try again later';
            })

        
        // RESEND VERIFICATION CODE CASES
        
            .addCase(resendVerificationCode.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(resendVerificationCode.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = true;
                state.message = action.payload.message;
            })
            .addCase(resendVerificationCode.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Failed to resend code. Please try again later';
            })

        
        // LOGIN CASES
        
            .addCase(login.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(login.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = action.payload.success;
                state.user = action.payload.user || null;
                state.isAuthenticated = Boolean(action.payload?.user);
            })
            .addCase(login.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload?.message;
            state.user = null;
            state.isAuthenticated = false;

            if (
                action.payload?.message
                ?.toLowerCase()
                .includes("verify your email")
            ) {
                state.needsVerification = true;
                state.verificationEmail = action.meta.arg.email;
            }
            })


        
        // LOAD USER CASES
        
            .addCase(loadUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(loadUser.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.user = action.payload.user || null;
                state.isAuthenticated = Boolean(action.payload?.user);
                state.initializing = false;
            })
            .addCase(loadUser.rejected, (state, action) => {
                state.loading = false;
                state.error = null; // Don't show error for failed loadUser
                state.user = null;
                state.isAuthenticated = false;
                state.initializing = false;
            })

        
        // LOGOUT CASES
        
            .addCase(logout.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(logout.fulfilled, (state) => {
                state.loading = false;
                state.error = null;
                state.user = null;
                state.isAuthenticated = false;
            })
            .addCase(logout.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Failed to logout. Please try again later';
            })

        
        // UPDATE PROFILE CASES
        
            .addCase(updateProfile.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(updateProfile.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.user = action.payload?.user || null;
                state.success = action.payload?.success;
                state.message = action.payload?.message;
            })
            .addCase(updateProfile.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Profile update failed. Please try again later';
            })

        
        // UPDATE PASSWORD CASES
        
            .addCase(updatePassword.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(updatePassword.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = action.payload?.success;
            })
            .addCase(updatePassword.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Password update failed. Please try again later';
            })

        
        // FORGOT PASSWORD CASES
        
            .addCase(forgotPassword.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(forgotPassword.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = true;
                state.message = action.payload?.message;
            })
            .addCase(forgotPassword.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Forgot password request failed. Please try again later';
            })

        
        // RESET PASSWORD CASES
        
            .addCase(resetPassword.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(resetPassword.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
                state.success = action.payload?.success;
                state.user = action.payload.user || null;
                state.isAuthenticated = Boolean(action.payload?.user);
            })
            .addCase(resetPassword.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload?.message || 'Password reset failed. Please try again later';
            });
    }
});

export const {removeErrors, removeSuccess, clearVerificationState} = userSlice.actions;
export default userSlice.reducer;