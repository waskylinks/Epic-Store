import React, { useEffect } from 'react'
import PageTitle from '../components/PageTitle'
import Footer from '../components/footer'
import '../CartStyles/PaymentSuccess.css'
import { Link, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'

function OrderSuccess() {
    const [searchParams] = useSearchParams()
    const reference = searchParams.get('reference')
    const {cartItems, shippingInfo} = useSelector(state => state.cart);
    const dispatch = useDispatch();
    
    useEffect(() => {
        const createOrderData = async() => {
            try{
                const orderItem = JSON.parse(sessionStorage.getItem('orderItem'))
                const orderData = {
                    shippingInfo: {
                        address: shippingInfo.address,
                        city: shippingInfo.city,
                        state: shippingInfo.state,
                        country: shippingInfo.country,
                        pinCode: shippingInfo.pinCode,
                        phoneNo: shippingInfo.phoneNo
                    },
                    orderItems: cartItems.map((item) => ({
                        name: item.name,
                        price: item.price,
                        quantity: item.quantity,
                        image: item.image,
                        product: item.productId
                    })),
                    paymentInfo: {
                        id: reference,
                        status: 'success',
                    },
                    itemPrice: orderItem.subtotal,
                    taxPrice: orderItem.tax,
                    shippingPrice: orderItem.shippingCharges,
                    totalPrice: orderItem.total,
                }
                console.log('sending data', orderData)
                
            } catch(error) {
                console.log('order creation error', error)
                toast.error(error.message || 'Failed to create order. Please try again later', {position: 'top-center', autoClose:2000});
            }
        }
        createOrderData();
    }, [reference, cartItems, shippingInfo, dispatch]);
   
  return (
    
    <>
    <PageTitle title='Order Status' />
    <Navbar />

    <div className="payment-success-container">
        <div className="success-content">
            <div className="success-icon">
                <div className="checkmark">

                </div>
            </div>
            <h1>
                Order Confirmed
            </h1>
            <p>
                Your payment was successful. Reference ID: <strong>
                    {reference}
                </strong>
            </p>
            <Link className='explore-btn' to='/orders/user'>
                View Orders
            </Link>
        </div>
    </div>

    <Footer />
    </>

  )
}

export default OrderSuccess