import React from 'react'
import PageTitle from '../components/PageTitle'
import Footer from '../components/footer'
import Navbar from '../components/Navbar'
import '../AdminStyles/Dashboard.css'
import { AddBox, AttachMoney, CheckCircle, Dashboard, Error, Inventory, People, ShoppingCart, Star } from '@mui/icons-material'
import { Link } from 'react-router-dom'

function AdminDashboard() {

  return (
    <>
    <PageTitle title='Admin Dashboard'/>
    <Navbar />

    <div className="dashboard-container">
        <div className="sidebar">
            <div className="logo">
                <Dashboard className='logo-icon'/>
                Admin Dashboard
            </div>
            <nav className="nav-menu">
                <div className="nav-section">
                    <h3>
                        Products
                    </h3>
                    <Link to='/admin/products'>
                        <Inventory className='nav-icon'/>
                        All Products
                    </Link>

                    <Link to='/admin/products/create'>
                        <AddBox className='nav-icon'/>
                        Create Product
                    </Link>
                </div>

                <div className="nav-section">
                    <h3>
                        Users
                    </h3>
                    <Link to='/admin/users'>
                        <People className='nav-icon'/>
                        All Users
                    </Link>
                </div>

                 <div className="nav-section">
                    <h3>
                        Reviews
                    </h3>
                    <Link to='/admin/reviewId'>
                        <Star className='nav-icon'/>
                        All Reviews
                    </Link>
                </div>
            </nav>
        </div>

        <div className="main-content">
            <div className="stats-grid">
                <div className="stat-box">
                    <Inventory className='icon' />
                    <h3>
                        Total Products
                    </h3>
                    <p>
                        {}
                    </p>
                </div>

                <div className="stat-box">
                    <ShoppingCart className='icon' />
                    <h3>
                        Total Orders
                    </h3>
                    <p>
                        {}
                    </p>
                </div>

                <div className="stat-box">
                    <Star className='icon' />
                    <h3>
                        Total Reviews
                    </h3>
                    <p>
                        {}
                    </p>
                </div>

                <div className="stat-box">
                    <AttachMoney className='icon' />
                    <h3>
                        Total Revenue
                    </h3>
                    <p>
                        {}
                    </p>
                </div>

                <div className="stat-box">
                    <Error className='icon' />
                    <h3>
                        Out of Stock
                    </h3>
                    <p>
                        {}
                    </p>
                </div>

                <div className="stat-box">
                    <CheckCircle className='icon' />
                    <h3>
                        In Stock
                    </h3>
                    <p>
                        {}
                    </p>
                </div>
            </div>
        </div>

    </div>

    <Footer />
    </>
  )
}

export default AdminDashboard