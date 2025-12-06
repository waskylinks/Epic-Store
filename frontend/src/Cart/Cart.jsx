import React from 'react'
import '../CartStyles/Cart.css'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'
import CartItem from './CartItem'
import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'

function Cart() {
    const {cartItems} = useSelector(state => state.cart) 

  return (
    <>
    <Navbar />
    <PageTitle title='Cart'/>
    {cartItems.length === 0 ? (
        <div className="empty-cart-container">
            <p className="empty-cart-message">
                Your Cart is Empty
            </p>
            <Link to='/products'
            className='viewProduct'>View Products</Link>
        </div>
    ) :
    (<>
    

    <div className="cart-page">

        <div className="cart-items">
            <div className="cart-items-heading">
                Your Cart
            </div>

            <div className="cart-table">
                <div className="cart-table-header">
                    <div className="header-product">
                        Product
                    </div>
                    <div className="header-quantity">
                        Quantity
                    </div>
                    <div className="header-total item-total-heading">
                        Item Total
                    </div>
                    <div className="header-action">
                        Actions
                    </div>
                </div>

                {/* cart items */}
                {cartItems && cartItems.map(item => <CartItem item={item} key={item.product}/>)}
            </div>
        </div>

        {/* Price summary */}
        <div className="price-summary">
            <h3 className="price-summary-heading">
                Price Summary
            </h3>
            <div className="summary-item">
                <p className="summary-label">
                    Subtotal :
                </p>
                <p className="summary-value">
                    200/-
                </p>
            </div>
            <div className="summary-item">
                <p className="summary-label">
                    Tax(18%) :
                </p>
                <p className="summary-value">
                    10/-
                </p>
            </div>
            <div className="summary-item">
                <p className="summary-label">
                    Shipping :
                </p>
                <p className="summary-value">
                    20/-
                </p>
            </div>
            <div className="summary-total">
                <p className="total-label">
                    Total :
                </p>
                <p className="total-value">
                    230/-
                </p>
            </div>
            <button className="checkout-btn">
                Proceed to Checkout
            </button>
        </div>

    </div>

    
    </>) }
    <Footer />
    </>
  )
}

export default Cart