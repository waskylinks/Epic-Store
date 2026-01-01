import React, { useEffect, useState, useMemo } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/UsersList.css';
import { Delete, Edit, Visibility } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { 
    fetchAllUsers, 
    deleteUser, 
    updateUserRole,
    removeErrors, 
    removeSuccess 
} from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function AllUsers() {
    const dispatch = useDispatch();
    const { users, loading, error, success } = useSelector(state => state.admin);

    const [searchTerm, setSearchTerm] = useState('');
    const [deleteModal, setDeleteModal] = useState({ open: false, user: null, loading: false });
    const [roleModal, setRoleModal] = useState({ open: false, user: null, loading: false });
    const [viewModal, setViewModal] = useState({ open: false, user: null });

    useEffect(() => {
        dispatch(fetchAllUsers());
    }, [dispatch]);

    // Fixed: No direct setState in effect, no missing deps
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
        if (success) {
            toast.success('Action completed successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setDeleteModal(prev => ({ ...prev, open: false, loading: false }));
            setRoleModal(prev => ({ ...prev, open: false, loading: false }));
        }
    }, [error, success, dispatch]);

    // Real-time search
    const filteredUsers = useMemo(() => {
        if (!searchTerm) return users;
        const lower = searchTerm.toLowerCase();
        return users.filter(user => 
            user.name.toLowerCase().includes(lower) ||
            user.email.toLowerCase().includes(lower)
        );
    }, [users, searchTerm]);

    const handleDelete = () => {
        if (deleteModal.user) {
            setDeleteModal(prev => ({ ...prev, loading: true }));
            dispatch(deleteUser(deleteModal.user._id));
        }
    };

    const handleRoleChange = () => {
        if (roleModal.user) {
            setRoleModal(prev => ({ ...prev, loading: true }));
            const newRole = roleModal.user.role === 'admin' ? 'user' : 'admin';
            dispatch(updateUserRole({ id: roleModal.user._id, role: newRole }));
        }
    };

    if (loading && users.length === 0) return <Loader />;

    return (
        <>
            <PageTitle title="All Users - Admin" />
            <Navbar />

            <div className="usersList-container">
                <h1 className="usersList-title">All Users</h1>

                {/* Search Bar */}
                <div className="usersList-search-container">
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="usersList-search-input"
                    />
                </div>

                {filteredUsers.length === 0 ? (
                    <p className="loading-message">No users found.</p>
                ) : (
                    <div className="usersList-table-container">
                        <table className="usersList-table">
                            <thead>
                                <tr>
                                    <th>S/N</th>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Joined</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((user, index) => (
                                    <tr key={user._id}>
                                        <td>{index + 1}</td>
                                        <td>{user.name}</td>
                                        <td>{user.email}</td>
                                        <td>
                                            <span className={`usersList-role-badge ${user.role}`}>
                                                {user.role.toUpperCase()}
                                            </span>
                                        </td>
                                        <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                                        <td className="usersList-actions">
                                            <button
                                                onClick={() => setViewModal({ open: true, user })}
                                                className="action-icon usersList-view-icon"
                                                title="View User"
                                            >
                                                <Visibility fontSize="small" />
                                            </button>

                                            <button
                                                onClick={() => setRoleModal({ open: true, user, loading: false })}
                                                className="action-icon edit-icon"
                                                title="Change Role"
                                            >
                                                <Edit fontSize="small" />
                                            </button>

                                            {user.role !== 'admin' && (
                                                <button
                                                    onClick={() => setDeleteModal({ open: true, user, loading: false })}
                                                    className="action-icon delete-icon"
                                                    title="Delete User"
                                                >
                                                    <Delete fontSize="small" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Footer />

            {/* View User Modal */}
            {viewModal.open && viewModal.user && (
                <div className="delete-modal-overlay" onClick={() => setViewModal({ open: false, user: null })}>
                    <div className="usersList-view-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>User Details</h2>
                        <div className="usersList-view-content">
                            <p><strong>Name:</strong> {viewModal.user.name}</p>
                            <p><strong>Email:</strong> {viewModal.user.email}</p>
                            <p><strong>Role:</strong> 
                                <span className={`usersList-role-badge ${viewModal.user.role}`}>
                                    {viewModal.user.role.toUpperCase()}
                                </span>
                            </p>
                            <p><strong>Joined:</strong> {new Date(viewModal.user.createdAt).toLocaleString()}</p>
                            <p><strong>ID:</strong> <code>{viewModal.user._id}</code></p>
                        </div>
                        <div className="usersList-view-close">
                            <button 
                                onClick={() => setViewModal({ open: false, user: null })}
                                className="delete-modal-cancel"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Role Change Modal */}
            {roleModal.open && roleModal.user && (
                <div className="delete-modal-overlay" onClick={() => setRoleModal({ open: false })}>
                    <div className="delete-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>Change User Role</h2>
                        <p>Update role for <strong>{roleModal.user.name}</strong></p>
                        <p>
                            Current: <strong>{roleModal.user.role.toUpperCase()}</strong><br/>
                            New: <strong>{roleModal.user.role === 'admin' ? 'USER' : 'ADMIN'}</strong>
                        </p>
                        <div className="delete-modal-buttons">
                            <button onClick={() => setRoleModal({ open: false })} className="delete-modal-cancel" disabled={roleModal.loading}>
                                Cancel
                            </button>
                            <button onClick={handleRoleChange} className="delete-modal-confirm" disabled={roleModal.loading}>
                                {roleModal.loading ? 'Updating...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Modal */}
            {deleteModal.open && deleteModal.user && (
                <div className="delete-modal-overlay" onClick={() => setDeleteModal({ open: false })}>
                    <div className="delete-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete User</h2>
                        <p>Are you sure you want to permanently delete this user?</p>
                        <div className="delete-modal-user">
                            <strong>{deleteModal.user.name}</strong><br/>
                            {deleteModal.user.email}
                        </div>
                        <div className="delete-modal-buttons">
                            <button onClick={() => setDeleteModal({ open: false })} className="delete-modal-cancel" disabled={deleteModal.loading}>
                                Cancel
                            </button>
                            <button onClick={handleDelete} className="delete-modal-confirm" disabled={deleteModal.loading}>
                                {deleteModal.loading ? 'Deleting...' : 'Delete User'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default AllUsers;