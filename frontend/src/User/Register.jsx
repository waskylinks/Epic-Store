import React, { useEffect, useState } from 'react';
import '../UserStyles/Form.css';
import '../UserStyles/OAuthButtons.css';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { register, removeErrors, removeSuccess } from '../features/products/userSlice';
import GoogleSignInButton from '../components/GoogleSignInButton';
import FacebookSignInButton from '../components/FacebookSignInButton';

function Register() {
    const [user, setUser] = useState({
        name: '',
        email: '',
        password: '',
    });
    const { name, email, password } = user;

    const [showPassword, setShowPassword] = useState(false);
    const [avatar, setAvatar] = useState('');
    const [avatarPreview, setAvatarPreview] = useState('./images/profile.webp');
    const [passwordStrength, setPasswordStrength] = useState('');

    const { success, loading, error, needsVerification, verificationEmail } = useSelector(state => state.user);
    const dispatch = useDispatch();
    const navigate = useNavigate();

    // Calculate password strength
    const calculatePasswordStrength = (pass) => {
        if (!pass) return '';
        let strength = 0;
        
        if (pass.length >= 12) strength++;
        if (pass.length >= 16) strength++;
        if (/[a-z]/.test(pass)) strength++;
        if (/[A-Z]/.test(pass)) strength++;
        if (/[0-9]/.test(pass)) strength++;
        if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)) strength++;

        if (strength <= 2) return 'weak';
        if (strength <= 4) return 'medium';
        if (strength <= 5) return 'strong';
        return 'very-strong';
    };

    const registerDataChange = (e) => {
        if (e.target.name === 'avatar') {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.readyState === 2) {
                    setAvatarPreview(reader.result);
                    setAvatar(reader.result);
                }
            };
            reader.readAsDataURL(e.target.files[0]);
        } else {
            const newValue = e.target.value;
            setUser({
                ...user,
                [e.target.name]: newValue
            });

            // Update password strength
            if (e.target.name === 'password') {
                setPasswordStrength(calculatePasswordStrength(newValue));
            }
        }
    };

    const registerSubmit = (e) => {
        e.preventDefault();
        
        if (!name || !email || !password) {
            toast.error('Please fill out all required fields', { position: 'top-center', autoClose: 1200 });
            return;
        }

        if (password.length < 12) {
            toast.error('Password must be at least 12 characters', { position: 'top-center', autoClose: 2000 });
            return;
        }

        const myForm = new FormData();
        myForm.set('name', name);
        myForm.set('email', email);
        myForm.set('password', password);
        myForm.set('avatar', avatar);

        dispatch(register(myForm));
    };

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
    }, [dispatch, error]);

    useEffect(() => {
        if (success && needsVerification) {
            toast.success('Registration successful! Please check your email for verification code.', { 
                position: 'top-center', 
                autoClose: 3000 
            });
            dispatch(removeSuccess());
            navigate('/verify-email', { state: { email: verificationEmail } });
        }
    }, [dispatch, success, needsVerification, verificationEmail, navigate]);

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    };

    const getStrengthColor = () => {
        switch (passwordStrength) {
            case 'weak': return '#f44336';
            case 'medium': return '#ff9800';
            case 'strong': return '#2196f3';
            case 'very-strong': return '#4caf50';
            default: return '#ccc';
        }
    };

    const getStrengthText = () => {
        switch (passwordStrength) {
            case 'weak': return 'Weak';
            case 'medium': return 'Medium';
            case 'strong': return 'Strong';
            case 'very-strong': return 'Very Strong';
            default: return '';
        }
    };

    return (
        <div className="form-container container">
            <div className="form-content">
                <form 
                    className="form" 
                    onSubmit={registerSubmit} 
                    encType='multipart/form-data'
                >
                    <h2>Sign Up</h2>

                    {/* OAuth Buttons */}
                    <div className="oauth-buttons-container">
                        <GoogleSignInButton text="Sign up with Google" />
                        <FacebookSignInButton text="Sign up with Facebook" />
                    </div>

                    {/* Divider */}
                    <div className="oauth-divider">
                        <span>OR</span>
                    </div>

                    {/* Email Registration Form */}
                    <div className="input-group">
                        <input 
                            type="text" 
                            placeholder='Username *' 
                            name='name' 
                            value={name} 
                            onChange={registerDataChange}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <input 
                            type="email" 
                            placeholder='Email *' 
                            name='email'
                            value={email} 
                            onChange={registerDataChange}
                            required
                        />
                    </div>

                    <div className="input-group password-group">
                        <input 
                            type={showPassword ? "text" : "password"} 
                            placeholder='Password (min 12 characters) *' 
                            name='password'
                            value={password} 
                            onChange={registerDataChange}
                            required
                        />
                        <button
                            type="button"
                            className="password-toggle"
                            onClick={togglePasswordVisibility}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                            {showPassword ? '👁️' : '👁️‍🗨️'}
                        </button>
                    </div>

                    {password && (
                        <div className="password-strength">
                            <div className="strength-bar-container">
                                <div 
                                    className="strength-bar"
                                    style={{
                                        width: `${(passwordStrength === 'weak' ? 25 : passwordStrength === 'medium' ? 50 : passwordStrength === 'strong' ? 75 : 100)}%`,
                                        backgroundColor: getStrengthColor()
                                    }}
                                ></div>
                            </div>
                            <span className="strength-text" style={{ color: getStrengthColor() }}>
                                {getStrengthText()}
                            </span>
                        </div>
                    )}

                    <div className="password-requirements">
                        <p>Password must contain:</p>
                        <ul>
                            <li className={password.length >= 12 ? 'valid' : ''}>
                                {password.length >= 12 ? '✓' : '○'} At least 12 characters
                            </li>
                            <li className={/[A-Z]/.test(password) ? 'valid' : ''}>
                                {/[A-Z]/.test(password) ? '✓' : '○'} One uppercase letter
                            </li>
                            <li className={/[a-z]/.test(password) ? 'valid' : ''}>
                                {/[a-z]/.test(password) ? '✓' : '○'} One lowercase letter
                            </li>
                            <li className={/[0-9]/.test(password) ? 'valid' : ''}>
                                {/[0-9]/.test(password) ? '✓' : '○'} One number
                            </li>
                            <li className={/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) ? 'valid' : ''}>
                                {/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) ? '✓' : '○'} One special character
                            </li>
                        </ul>
                    </div>

                    <div className="input-group avatar-group">
                        <label htmlFor="avatar-input">Profile Picture (Optional)</label>
                        <input 
                            id="avatar-input"
                            type="file" 
                            name='avatar'
                            className='file-input' 
                            accept='image/*' 
                            onChange={registerDataChange}
                        />
                        <img src={avatarPreview} alt="Avatar Preview" className='avatar'/>
                    </div>

                    <button className="authBtn" disabled={loading}>
                        {loading ? 'Signing Up...' : 'Sign Up'}
                    </button>

                    <p className="form-links">
                        Already have an account? 
                        <Link to='/login'> Sign in here</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default Register;