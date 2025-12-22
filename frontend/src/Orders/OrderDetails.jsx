import React from 'react'
import '../OrderStyles/OrderDetails.css'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'

function OrderDetails() {
  return (
    <>
    <PageTitle title="Order ID" />
    <Navbar />

    <div className="order-box">
        <div className="table-block">
            <h2 className="table-title">
                Order Items
            </h2>
            <table className="table-main">
                <thead>
                    <tr>
                        <th className="head-cell">
                            {}
                        </th>
                        <th className="head-cell">
                            {}
                        </th>
                        <th className="head-cell">
                            {}
                        </th>
                        <th className="head-cell">
                            {}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr className='table-row'>
                        <td className="table-cell">
                            <img src="" alt="Image Item" className='item-img'/>
                        </td>
                        <td className="table-cell">
                            Mobile
                        </td>
                        <td className="table-cell">
                            3
                        </td>
                        <td className="table-cell">
                            100
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    {/* Shipping info table */}
    <div className="table-block">
        <h2 className="table-title">
            Shipping Info
        </h2>
        <table className="table-main">
            <tbody>
                <tr className="table-row">
                    <th className="table-cell">
                        Address
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    {/* Order Summary */}
    <div className="table-block">
        <h2 className="table-tit">
            Order Summary
        </h2>
        <table className="table-main">
            <tbody>
                <tr className="table-row">
                    <th className="table-cell">
                        Order Status
                    </th>
                    <td className="table-cell">
                        <span className="status-tag processing">
                            {}
                        </span>
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        Payment Status
                    </th>
                    <td className="table-cell">
                        <span className="pay-tag paid">
                            {}
                        </span>
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        Paid At
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        Item Price
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        Items Price
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        TaxPrice
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        Shipping Price
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>

                <tr className="table-row">
                    <th className="table-cell">
                        Total Price
                    </th>
                    <td className="table-cell">
                        {}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <Footer />
    </>
  )
}

export default OrderDetails