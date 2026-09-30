import { ApiClient } from './api-client.js';

export async function loginUser(user, code) {
    try {
        const response = await ApiClient.post('/auth/login', { user, code });
        // Returns the full response object:
        // - If no active session: { token, user }  (token is already set by ApiClient)
        // - If active session exists: { hasActiveSession: true, user }
        // - On error: throws
        if (response.token) {
            ApiClient.setToken(response.token);
        }
        return response;
    } catch (error) {
        // Don't log sensitive error details to console for security
        throw error;
    }
}

/**
 * Confirm Login — Step 2 of the two-step single-session flow.
 * Called after the user confirms they want to replace the existing session.
 * Server will blacklist the old session, notify it via Socket.IO,
 * and return a new token.
 */
export async function confirmLogin(user, code) {
    try {
        const response = await ApiClient.post('/auth/confirm-login', { user, code });
        if (response.token) {
            ApiClient.setToken(response.token);
            return response.user;
        }
        return null;
    } catch (error) {
        throw error;
    }
}

/**
 * Logout: calls backend to blacklist the current token,
 * then clears local session regardless of server response.
 */
export async function logoutUser() {
    try {
        await ApiClient.post('/auth/logout');
    } catch (error) {
        // If logout fails (e.g., network error), still clear local session
        console.warn('Logout API call failed, clearing local session:', error.message);
    } finally {
        ApiClient.setToken(null);
        localStorage.removeItem('pos_user');
    }
}

export async function getUsers() {
    return await ApiClient.get('/users');
}

export async function saveUser(data, id = null) {
    return await ApiClient.post('/users', { id, ...data });
}

export async function deleteUser(id) {
    return await ApiClient.delete(`/users/${id}`);
}
