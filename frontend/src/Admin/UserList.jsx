import { useEffect, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import {
  fetchAllUsers,
  deleteUser,
  updateUserRole,
  clearUserStatus,
} from '../features/admin/adminSlice';
import '../AdminStyles/UsersList.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_CONFIG = {
  user: {
    label: 'User',
    desc: 'Standard customer account',
    badgeClass: 'ul-badge--user',
  },
  admin: {
    label: 'Admin',
    desc: 'Manage products, orders and content',
    badgeClass: 'ul-badge--admin',
  },
  superAdmin: {
    label: 'Super Admin',
    desc: 'Full access including admin management',
    badgeClass: 'ul-badge--superAdmin',
  },
};

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Newest First' },
  { value: 'oldest',    label: 'Oldest First' },
  { value: 'name_asc',  label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const getInitials = (user) => {
  const f = user.firstName?.charAt(0) || '';
  const l = user.lastName?.charAt(0) || '';
  return `${f}${l}`.toUpperCase() || 'U';
};

const getFullName = (user) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown User';

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows({ count = 10 }) {
  return Array.from({ length: count }).map((_, i) => (
    <tr key={i} className="ul-row ul-row--skeleton">
      <td>
        <div className="ul-user-cell">
          <div className="ul-skeleton ul-skeleton--avatar" />
          <div className="ul-user-info">
            <div className="ul-skeleton ul-skeleton--text" style={{ width: '55%' }} />
            <div className="ul-skeleton ul-skeleton--text" style={{ width: '75%', marginTop: 4 }} />
          </div>
        </div>
      </td>
      <td className="ul-th--hide-sm"><div className="ul-skeleton ul-skeleton--badge" /></td>
      <td className="ul-th--hide-md"><div className="ul-skeleton ul-skeleton--text" style={{ width: '60px' }} /></td>
      <td className="ul-th--hide-md"><div className="ul-skeleton ul-skeleton--text" style={{ width: '80px' }} /></td>
      <td className="ul-th--hide-lg"><div className="ul-skeleton ul-skeleton--text" style={{ width: '70px' }} /></td>
      <td><div className="ul-skeleton ul-skeleton--actions" /></td>
    </tr>
  ));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AllUsers() {
  const dispatch = useDispatch();

  const {
    users,
    userLoading,
    userError,
    userSuccess,
    userTotal,
    userTotalPages,
    userCurrentPage,
    userResultPerPage,
    userStats,
  } = useSelector((state) => state.admin);

  // Current logged-in user — needed to gate superAdmin actions
  const currentUser = useSelector((state) => state.user.user);

  // ── Local state ──────────────────────────────────────────────────────────
  const [searchInput,  setSearchInput]  = useState('');
  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('all');
  const [sortKey,      setSortKey]      = useState('newest');
  const [page,         setPage]         = useState(1);
  const [filtersOpen,  setFiltersOpen]  = useState(false);
  const [toast,        setToast]        = useState(null);
  const [isFirstLoad,  setIsFirstLoad]  = useState(true);

  const [deleteModal, setDeleteModal] = useState({ open: false, user: null });
  const [roleModal,   setRoleModal]   = useState({ open: false, user: null, selectedRole: '' });
  const [viewModal,   setViewModal]   = useState({ open: false, user: null });

  // ── Toast ─────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const doFetch = useCallback(() => {
    dispatch(fetchAllUsers({
      page,
      limit: 20,
      ...(search                 && { search }),
      ...(roleFilter !== 'all'   && { role: roleFilter }),
      ...(sortKey                && { sort: sortKey }),
    })).finally(() => setIsFirstLoad(false));
  }, [dispatch, page, search, roleFilter, sortKey]);

  useEffect(() => { doFetch(); }, [doFetch]);

  // ── Debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Reset page on filter change ───────────────────────────────────────────
  useEffect(() => { setPage(1); }, [roleFilter, sortKey]);

  // ── Handle success / error ────────────────────────────────────────────────
  // Uses dedicated userSuccess / userError — NOT the shared success flag.
  // This is the fix for the stuck loading bug: the old code watched state.success
  // which is shared with orders/reviews and could be stale.
  useEffect(() => {
    if (userSuccess) {
      showToast('Action completed successfully.');
      dispatch(clearUserStatus());
      setDeleteModal({ open: false, user: null });
      setRoleModal({ open: false, user: null, selectedRole: '' });
      // Re-fetch stats after a role change or delete
      doFetch();
    }
    if (userError) {
      showToast(userError, 'error');
      dispatch(clearUserStatus());
    }
  }, [userSuccess, userError, dispatch, showToast, doFetch]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openRoleModal = (user) => {
    setRoleModal({ open: true, user, selectedRole: user.role });
  };

  const handleRoleChange = () => {
    if (!roleModal.user || !roleModal.selectedRole) return;
    if (roleModal.selectedRole === roleModal.user.role) {
      setRoleModal({ open: false, user: null, selectedRole: '' });
      return;
    }
    dispatch(updateUserRole({ id: roleModal.user._id, role: roleModal.selectedRole }));
  };

  const handleDelete = () => {
    if (deleteModal.user) dispatch(deleteUser(deleteModal.user._id));
  };

  const activeFiltersCount = [
    roleFilter !== 'all',
    search.trim() !== '',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setRoleFilter('all');
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  // Can the current user manage roles?
  const isSuperAdmin = currentUser?.role === 'superAdmin';

  // ── Stat cards ────────────────────────────────────────────────────────────
  const statCards = [
    { label: 'Total Users',    value: userStats ? userStats.total        : userTotal, color: 'coral'  },
    { label: 'Regular Users',  value: userStats?.regularUsers ?? '—',                color: 'default' },
    { label: 'Admins',         value: userStats?.admins       ?? '—',                color: 'blue'    },
    { label: 'Super Admins',   value: userStats?.superAdmins  ?? '—',                color: 'purple'  },
    { label: 'Verified',       value: userStats?.verified     ?? '—',                color: 'green'   },
  ];

  // ── First-load skeleton ───────────────────────────────────────────────────
  if (isFirstLoad && userLoading) {
    return (
      <>
        <Navbar />
        <main className="ul-main">
          <div className="ul-skeleton-page">
            <div className="ul-skeleton ul-skeleton--title" />
            <div className="ul-skeleton-stats">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="ul-stat ul-stat--skeleton">
                  <div className="ul-skeleton ul-skeleton--stat-val" />
                  <div className="ul-skeleton ul-skeleton--stat-label" />
                </div>
              ))}
            </div>
            <div className="ul-skeleton ul-skeleton--toolbar" />
            <div className="ul-skeleton" style={{ height: 380, borderRadius: 12 }} />
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageTitle title="Users — Admin" />
      <Navbar />

      <main className="ul-main">

        {/* ── Toast ── */}
        {toast && (
          <div className={`ul-toast ul-toast--${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : toast.type === 'warn' ? '⚠' : '✕'}</span>
            {toast.msg}
          </div>
        )}

        {/* ── Header ── */}
        <Link to="/admin/dashboard" className="ul-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Dashboard
        </Link>

        <div className="ul-header">
          <div className="ul-header__left">
            <h1 className="ul-title">Users</h1>
            <span className="ul-subtitle">{userTotal.toLocaleString()} total accounts</span>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="ul-stats">
          {statCards.map((s) => (
            <div key={s.label} className={`ul-stat ul-stat--${s.color}`}>
              <span className="ul-stat__value">
                {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
              </span>
              <span className="ul-stat__label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="ul-toolbar">
          <div className="ul-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button className="ul-search__clear" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>✕</button>
            )}
          </div>

          <div className="ul-toolbar__actions">
            <button
              className={`ul-btn ul-btn--filter ${filtersOpen ? 'active' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filters
              {activeFiltersCount > 0 && <span className="ul-filter-badge">{activeFiltersCount}</span>}
            </button>

            <select className="ul-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Filter Panel ── */}
        {filtersOpen && (
          <div className="ul-filters">
            <div className="ul-filter-group">
              <label>Role</label>
              <div className="ul-filter-pills">
                {['all', 'user', 'admin', 'superAdmin'].map((r) => (
                  <button
                    key={r}
                    className={`ul-pill ${roleFilter === r ? 'active' : ''}`}
                    onClick={() => setRoleFilter(r)}
                  >
                    {r === 'all' ? 'All' : ROLE_CONFIG[r]?.label || r}
                  </button>
                ))}
              </div>
            </div>
            <button className="ul-btn ul-btn--ghost" style={{ alignSelf: 'flex-start', padding: '6px 14px', fontSize: '12.5px' }} onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        )}

        {/* ── Error ── */}
        {userError && !userLoading && (
          <div className="ul-error">
            <span>⚠</span> {userError}
            <button onClick={doFetch}>Retry</button>
          </div>
        )}

        {/* ── Table ── */}
        <div className={`ul-table-wrap ${userLoading && !isFirstLoad ? 'ul-table-wrap--loading' : ''}`}>
          {!userLoading && users.length === 0 ? (
            <div className="ul-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p>No users found</p>
              <span>Try adjusting your search or filters</span>
            </div>
          ) : (
            <table className="ul-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="ul-th--hide-sm">Role</th>
                  <th className="ul-th--hide-md">Provider</th>
                  <th className="ul-th--hide-md">Verified</th>
                  <th className="ul-th--hide-lg">Joined</th>
                  <th className="ul-th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userLoading
                  ? <SkeletonRows count={userResultPerPage} />
                  : users.map((user, i) => {
                    const cfg = ROLE_CONFIG[user.role] || ROLE_CONFIG.user;
                    return (
                      <tr
                        key={user._id}
                        className="ul-row"
                        style={{ animationDelay: `${i * 18}ms` }}
                      >
                        {/* User cell */}
                        <td className="ul-td--user">
                          <div className="ul-user-cell">
                            <div className="ul-avatar">
                              {user.avatar?.url && !user.avatar.url.includes('ui-avatars')
                                ? <img src={user.avatar.url} alt={getFullName(user)} loading="lazy" />
                                : <span className="ul-avatar__initials">{getInitials(user)}</span>
                              }
                            </div>
                            <div className="ul-user-info">
                              <span className="ul-user-name">{getFullName(user)}</span>
                              <span className="ul-user-email">{user.email}</span>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="ul-th--hide-sm">
                          <span className={`ul-badge ${cfg.badgeClass}`}>
                            {cfg.label}
                          </span>
                        </td>

                        {/* Provider */}
                        <td className="ul-th--hide-md">
                          <span className="ul-provider">
                            {user.authProvider === 'google'   && '🔵 '}
                            {user.authProvider === 'facebook' && '🔷 '}
                            {user.authProvider === 'local'    && '✉ '}
                            {user.authProvider}
                          </span>
                        </td>

                        {/* Verified */}
                        <td className="ul-th--hide-md">
                          <span className={`ul-verified ${user.emailVerified ? 'ul-verified--yes' : 'ul-verified--no'}`}>
                            {user.emailVerified ? '✓ Yes' : '✕ No'}
                          </span>
                        </td>

                        {/* Joined */}
                        <td className="ul-th--hide-lg" style={{ fontSize: 12.5, color: 'var(--ul-text-muted)', fontWeight: 500 }}>
                          {new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>

                        {/* Actions */}
                        <td className="ul-td--actions">
                          <div className="ul-actions">
                            {/* View */}
                            <button
                              className="ul-action-btn ul-action-btn--view"
                              onClick={() => setViewModal({ open: true, user })}
                              title="View details"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>

                            {/* Change role — superAdmin only for elevated accounts */}
                            {(isSuperAdmin || user.role === 'user') && (
                              <button
                                className="ul-action-btn ul-action-btn--edit"
                                onClick={() => openRoleModal(user)}
                                title="Change role"
                                disabled={userLoading}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                              </button>
                            )}

                            {/* Delete — only regular users, only superAdmin can delete admins */}
                            {user.role === 'user' && (
                              <button
                                className="ul-action-btn ul-action-btn--delete"
                                onClick={() => setDeleteModal({ open: true, user })}
                                title="Delete user"
                                disabled={userLoading}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        {userTotalPages > 1 && (
          <div className="ul-pagination">
            <span className="ul-pagination__info">
              Showing {((userCurrentPage - 1) * userResultPerPage) + 1}–{Math.min(userCurrentPage * userResultPerPage, userTotal).toLocaleString()} of {userTotal.toLocaleString()}
            </span>
            <div className="ul-pagination__controls">
              <button className="ul-page-btn" disabled={userCurrentPage === 1} onClick={() => setPage(1)}>«</button>
              <button className="ul-page-btn" disabled={userCurrentPage === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
              {Array.from({ length: Math.min(5, userTotalPages) }, (_, i) => {
                let p;
                if (userTotalPages <= 5)                       p = i + 1;
                else if (userCurrentPage <= 3)                 p = i + 1;
                else if (userCurrentPage >= userTotalPages - 2) p = userTotalPages - 4 + i;
                else                                           p = userCurrentPage - 2 + i;
                return (
                  <button
                    key={p}
                    className={`ul-page-btn ${userCurrentPage === p ? 'active' : ''}`}
                    onClick={() => setPage(p)}
                  >{p}</button>
                );
              })}
              <button className="ul-page-btn" disabled={userCurrentPage === userTotalPages} onClick={() => setPage((p) => p + 1)}>›</button>
              <button className="ul-page-btn" disabled={userCurrentPage === userTotalPages} onClick={() => setPage(userTotalPages)}>»</button>
            </div>
          </div>
        )}
      </main>

      {/* ── View Modal ── */}
      {viewModal.open && viewModal.user && (
        <div className="ul-modal-overlay" onClick={() => setViewModal({ open: false, user: null })}>
          <div className="ul-modal ul-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="ul-view-header">
              <div className="ul-view-avatar">
                {viewModal.user.avatar?.url && !viewModal.user.avatar.url.includes('ui-avatars')
                  ? <img src={viewModal.user.avatar.url} alt={getFullName(viewModal.user)} />
                  : <span className="ul-view-avatar__initials">{getInitials(viewModal.user)}</span>
                }
              </div>
              <div>
                <div className="ul-view-name">{getFullName(viewModal.user)}</div>
                <div className="ul-view-email">{viewModal.user.email}</div>
              </div>
            </div>

            <div className="ul-view-grid">
              <div className="ul-view-field">
                <label>Role</label>
                <span><span className={`ul-badge ${ROLE_CONFIG[viewModal.user.role]?.badgeClass}`}>{ROLE_CONFIG[viewModal.user.role]?.label}</span></span>
              </div>
              <div className="ul-view-field">
                <label>Auth Provider</label>
                <span style={{ textTransform: 'capitalize' }}>{viewModal.user.authProvider}</span>
              </div>
              <div className="ul-view-field">
                <label>Email Verified</label>
                <span className={`ul-verified ${viewModal.user.emailVerified ? 'ul-verified--yes' : 'ul-verified--no'}`}>
                  {viewModal.user.emailVerified ? '✓ Verified' : '✕ Not verified'}
                </span>
              </div>
              <div className="ul-view-field">
                <label>Joined</label>
                <span>{new Date(viewModal.user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
              <div className="ul-view-field" style={{ gridColumn: '1 / -1' }}>
                <label>User ID</label>
                <code>{viewModal.user._id}</code>
              </div>
            </div>

            <div className="ul-modal__actions">
              <button className="ul-btn ul-btn--ghost" onClick={() => setViewModal({ open: false, user: null })}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Role Modal ── */}
      {roleModal.open && roleModal.user && (
        <div className="ul-modal-overlay" onClick={() => setRoleModal({ open: false, user: null, selectedRole: '' })}>
          <div className="ul-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Change Role</h3>
            <p style={{ marginBottom: 16 }}>
              Update role for <strong>{getFullName(roleModal.user)}</strong>
            </p>

            <div className="ul-role-current">
              <span>Current role</span>
              <span className={`ul-badge ${ROLE_CONFIG[roleModal.user.role]?.badgeClass}`}>
                {ROLE_CONFIG[roleModal.user.role]?.label}
              </span>
            </div>

            <div className="ul-role-options">
              {Object.entries(ROLE_CONFIG)
                .filter(([key]) => {
                  // Non-superAdmins can only assign 'user' or 'admin'
                  if (!isSuperAdmin && key === 'superAdmin') return false;
                  return true;
                })
                .map(([key, cfg]) => (
                  <div
                    key={key}
                    className={`ul-role-option ${roleModal.selectedRole === key ? 'selected' : ''}`}
                    onClick={() => setRoleModal((prev) => ({ ...prev, selectedRole: key }))}
                  >
                    <div className="ul-role-option__dot" />
                    <div className="ul-role-option__info">
                      <div className="ul-role-option__name">{cfg.label}</div>
                      <div className="ul-role-option__desc">{cfg.desc}</div>
                    </div>
                  </div>
                ))
              }
            </div>

            {/* Warn when promoting to superAdmin */}
            {roleModal.selectedRole === 'superAdmin' && roleModal.user.role !== 'superAdmin' && (
              <div className="ul-role-warn">
                ⚠ You are granting full system access including the ability to manage other admins. This cannot be undone without superAdmin access.
              </div>
            )}

            <div className="ul-modal__actions">
              <button
                className="ul-btn ul-btn--ghost"
                onClick={() => setRoleModal({ open: false, user: null, selectedRole: '' })}
                disabled={userLoading}
              >
                Cancel
              </button>
              <button
                className="ul-btn ul-btn--primary"
                onClick={handleRoleChange}
                disabled={userLoading || roleModal.selectedRole === roleModal.user.role}
              >
                {userLoading ? 'Updating…' : 'Confirm Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteModal.open && deleteModal.user && (
        <div className="ul-modal-overlay" onClick={() => setDeleteModal({ open: false, user: null })}>
          <div className="ul-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ul-modal__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3>Delete User</h3>
            <p>
              This will permanently delete <strong>{getFullName(deleteModal.user)}</strong>'s account
              ({deleteModal.user.email}). This action cannot be undone.
            </p>
            <div className="ul-modal__actions">
              <button className="ul-btn ul-btn--ghost" onClick={() => setDeleteModal({ open: false, user: null })} disabled={userLoading}>
                Cancel
              </button>
              <button className="ul-btn ul-btn--danger" onClick={handleDelete} disabled={userLoading}>
                {userLoading ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}