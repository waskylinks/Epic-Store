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

    // ⚠️ IMPORTANT: These calculations are for DISPLAY ONLY
    // The backend will recalculate from database prices
    // This prevents price manipulation attacks
    const subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const tax = subtotal * 0.18;
    const shipping = subtotal > 500 ? 0 : 50;
    const total = subtotal + tax + shipping;

    const proceedToPayment = () => {
        // Store display data only (not used for actual payment)
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

    const formatNGN = (amount) =>
        new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            minimumFractionDigits: 2
        }).format(amount);

    return (
        <>
            <PageTitle title='Order Confirm' />
            <Navbar />
            <CheckoutPath activePath={1} />

            <div className="confirm-container">
                <h1 className="confirm-header">Order Confirmation</h1>

                {/* Info Banner */}
                <div className="info-banner">
                    <p>
                        ℹ️ Please review your order details before proceeding to payment.
                        Final prices will be calculated securely on our servers.
                    </p>
                </div>

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
                                    <td>{formatNGN(item.price)}</td>
                                    <td>{item.quantity}</td>
                                    <td>{formatNGN(item.price * item.quantity)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Order Summary Table */}
                    <table className="confirm-table">
                        <caption>Order Summary (Estimated)</caption>
                        <thead>
                            <tr>
                                <th>Subtotal</th>
                                <th>Shipping Charges</th>
                                <th>Tax (18%)</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>{formatNGN(subtotal)}</td>
                                <td>{formatNGN(shipping)}</td>
                                <td>{formatNGN(tax)}</td>
                                <td>{formatNGN(total)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <p className="summary-note">
                        * Final amount will be calculated at checkout based on current product prices
                    </p>
                </div>

                {/* Proceed to Payment Button */}
                <button
                    type="button"
                    className="proceed-button"
                    onClick={proceedToPayment}
                    disabled={cartItems.length === 0}
                >
                    Proceed to Payment
                </button>
            </div>

            <Footer />
        </>
    );
}

export default OrderConfirm;