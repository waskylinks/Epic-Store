/**
 * Enterprise-level password validation
 * Requirements:
 * - Minimum 12 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character
 * - No common passwords
 */

const commonPasswords = [
    'password123', 'admin123456', '123456789012', 'qwerty123456',
    'welcome12345', 'password1234', 'letmein12345', 'administrator'
];

export const validatePassword = (password) => {
    const errors = [];
    
    // Check length
    if (!password || password.length < 12) {
        errors.push('Password must be at least 12 characters long');
    }
    
    // Check for uppercase
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    // Check for lowercase
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    // Check for number
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    // Check for special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character (!@#$%^&* etc.)');
    }
    
    // Check against common passwords
    if (commonPasswords.includes(password.toLowerCase())) {
        errors.push('This password is too common. Please choose a stronger password');
    }
    
    // Check for sequential characters
    if (/(.)\1{2,}/.test(password)) {
        errors.push('Password should not contain repeating characters (e.g., aaa, 111)');
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        strength: calculatePasswordStrength(password)
    };
};

/**
 * Calculate password strength
 * Returns: weak, medium, strong, very-strong
 */
export const calculatePasswordStrength = (password) => {
    if (!password) return 'weak';
    
    let score = 0;
    
    // Length score
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (password.length >= 20) score += 1;
    
    // Character variety
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 1;
    
    // Complexity bonus
    if (/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/.test(password)) {
        score += 1;
    }
    
    if (score <= 3) return 'weak';
    if (score <= 5) return 'medium';
    if (score <= 7) return 'strong';
    return 'very-strong';
};

/**
 * Validate that password matches confirmation
 */
export const validatePasswordMatch = (password, confirmPassword) => {
    if (password !== confirmPassword) {
        return {
            isValid: false,
            error: 'Passwords do not match'
        };
    }
    return { isValid: true };
};