import React from 'react'
import PageTitle from '../components/PageTitle'
import Footer from '../components/footer'
import '../CartStyles/PaymentSuccess.css'
import { Link, useSearchParams } from 'react-router-dom'

function OrderSuccess() {
    const [searchParams] = useSearchParams()
    const reference = searchParams.get('reference')
   
  return (
    
    <>
    <PageTitle title='Order Success' />

    <div className="payment-success-container">
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
        <Link className='explore-btn' to='/'>
            Explore more Products
        </Link>
    </div>

    <Footer />
    </>

  )
}

export default OrderSuccess