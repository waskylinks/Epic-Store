import React from 'react'
import { useSelector } from 'react-redux'
import Loader from './Loader'
import { Navigate, useLocation } from 'react-router-dom'


function ProtectedRoute({element, adminOnly = false}) {
    const {isAuthenticated, loading, user} = useSelector((state) => state.user)
    const location = useLocation()

    if(loading) {
        return <Loader />
    }

    if(!isAuthenticated) {
        return <Navigate to='/login' state={{ from: location }}/>
    }

    if(adminOnly && user.role !== 'admin') {
        return <Navigate to='/' />
    }


  return element
}

export default ProtectedRoute