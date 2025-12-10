import React from 'react';
import '../CartStyles/Payment.css'
import Navbar from '../components/Navbar';
import PageTitle from '../components/PageTitle';
import Footer from '../components/footer';
import { Link } from 'react-router-dom';
import CheckoutPath from './CheckoutPath';

function Payment() {
    const orderItem = JSON.parse(sessionStorage.getItem('orderItem'))

  return (
    <>
    <PageTitle title='Payment Processing'/>
    <Navbar />
    <CheckoutPath activePath={2}/>

    <div className="payment-container">
        <Link 
        to='/order/confirm'
        className='payment-go-back'>
            Go Back
        </Link>
        <button className="payment-btn">
            Pay ({orderItem.total})/-
        </button>
    </div>

    <Footer />
    </>
  )
}

export default Payment