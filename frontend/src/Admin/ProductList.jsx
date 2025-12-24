import React from 'react'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'
import '../AdminStyles/ProductsList.css'
import { Link } from 'react-router-dom'
import { Delete, Edit } from '@mui/icons-material'

function ProductList() {
  return (
    <>
    <PageTitle title='Admin Products'/>
    <Navbar />

    <div className="product-list-container">
        <h1 className="product-list-title">
            All Products
        </h1>
        <table className="product-table">
            <thead>
                <tr>
                    <th>S1 NO</th>
                    <th>Product Image</th>
                    <th>Product Name</th>
                    <th>Price</th>
                    <th>Ratings</th>
                    <th>Category</th>
                    <th>Stock</th>
                    <th>Created At</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>1</td>
                    <td>
                        <img src="" alt="" />
                    </td>
                    <td>
                        {}
                    </td>
                    <td>
                        {}
                    </td>
                    <td>
                        {}
                    </td>
                    <td>
                        {}
                    </td>
                    <td>
                        {}
                    </td>
                    <td>
                        {}
                    </td>
                    <td>
                        <Link to='/admin/product/:productId'>
                            <Edit />
                        </Link>
                        <Link to='/admin/product/:productId'>
                            <Delete />
                        </Link>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <Footer />
    </>
  )
}

export default ProductList