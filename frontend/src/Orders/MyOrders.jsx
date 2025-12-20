import React, { useEffect } from 'react'
import '../OrderStyles/MyOrders.css'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'
import { Link } from 'react-router-dom'
import { LaunchOutlined } from '@mui/icons-material'
import { useDispatch, useSelector } from 'react-redux'
import { getAllMyOrders } from '../features/cart/orderSlice'
import { toast } from 'react-toastify'
import { removeErrors } from '../features/cart/orderSlice'
import Loader from '../components/Loader';

function MyOrders() {
    const {orders, loading, error} = useSelector(state => state.order)
    console.log('my orders data', orders)
    const dispatch = useDispatch()

    useEffect(() => {
        dispatch(getAllMyOrders())
        if(error) {
            toast.error(error, {position: 'top-center'});
            dispatch(removeErrors())
            
        }
    }, [dispatch, error]);

    const formatNGN = (amount) =>
        new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            minimumFractionDigits: 2
        }).format(amount);

  return (

    <>
    <PageTitle title='All Orders'/>
    <Navbar />

    { loading ? (<Loader />) : Array.isArray(orders) && orders.length > 0 ? (
        <div className="my-orders-container">
            <h1>
                My Orders
            </h1>
            <div className="table-responsive">
                <table className="orders-table">
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Items Count</th>
                            <th>Status</th>
                            <th>Total Price</th>
                            <th>View Order</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((order) => (
                            <tr key={order._id}>
                            <td>{order._id}</td>
                            <td>{order.orderItems.length}</td>
                            <td>{order.orderStatus}</td>
                            <td>{formatNGN(order.totalPrice)}</td>
                            <td>
                                <Link to={`/order/${order._id}`} className="order-link">
                                <LaunchOutlined />
                                </Link>
                            </td>
                            </tr>
                        ))}
                    </tbody>

                    </table>
                </div>
        </div>) : (
            <div className="no-orders">
                <p className="no-order-message">
                    You have not placed any orders yet.
                </p>
                <Link to='/' className="shop-now-btn">
                    Shop Now
                </Link>
            </div>
        )
        }

    <Footer />

    </>
  )
}

export default MyOrders