import React from 'react';
import '../CartStyles/OrderConfirm.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useSelector } from 'react-redux';
import CheckoutPath from './CheckoutPath';
import { useNavigate } from 'react-router-dom';

function OrderConfirm() {
    const { shippingInfo, cartItems } = useSelector(state => state.cart);
    const { user } = useSelector(state => state.user);

    const navigate = useNavigate();

    // Price calculations
    const subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const tax = subtotal * 0.18;
    const shipping = subtotal > 500 ? 0 : 50;
    const total = subtotal + tax + shipping;

    const proceedToPayment = () => {
        const data = {
            subtotal,
            tax,
            shipping,
            total,
            cartItems,
            shippingInfo
        };
        sessionStorage.setItem('orderItem', JSON.stringify(data));
        navigate('/process/payment');
    };

    return (
        <>
            <PageTitle title='Order Confirm' />
            <Navbar />
            <CheckoutPath activePath={1} />

            <div className="confirm-container">
                <h1 className="confirm-header">Order Confirmation</h1>

                {/* Shipping Info Table */}
                <div className="confirm-table-container">
                    <table className="confirm-table">
                        <caption>Shipping Details</caption>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Phone</th>
                                <th>Address</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>{user.name}</td>
                                <td>{shippingInfo.phoneNo}</td>
                                <td>
                                    {shippingInfo.address}, {shippingInfo.city}, {shippingInfo.state}, {shippingInfo.country}-{shippingInfo.pinCode}
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    {/* Cart Items Table */}
                    <table className="confirm-table cart-table">
                        <caption>Cart Items</caption>
                        <thead>
                            <tr>
                                <th>Image</th>
                                <th>Product Name</th>
                                <th>Price</th>
                                <th>Quantity</th>
                                <th>Total Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cartItems.map(item => (
                                <tr key={item.product}>
                                    <td><img src={item.image} alt={item.name} className='product-image' /></td>
                                    <td>{item.name}</td>
                                    <td>₦{item.price.toFixed(2)}</td>
                                    <td>{item.quantity}</td>
                                    <td>₦{(item.price * item.quantity).toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Order Summary Table */}
                    <table className="confirm-table">
                        <caption>Order Summary</caption>
                        <thead>
                            <tr>
                                <th>Subtotal</th>
                                <th>Shipping Charges</th>
                                <th>GST</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>₦{subtotal.toFixed(2)}</td>
                                <td>₦{shipping.toFixed(2)}</td>
                                <td>₦{tax.toFixed(2)}</td>
                                <td>₦{total.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Proceed to Payment Button */}
                <button
                    type="button"
                    className="proceed-button"
                    onClick={proceedToPayment}
                    disabled={cartItems.length === 0} // disable if cart is empty
                >
                    Proceed to Payment
                </button>
            </div>

            <Footer />
        </>
    );
}

export default OrderConfirm;
