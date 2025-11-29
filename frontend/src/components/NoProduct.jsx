import React from 'react'
import '../componentStyles/NoProducts.css'
import { MdWarningAmber } from "react-icons/md"

function NoProduct({ keyword }) {
  return (
    <div className="no-products-content">
        
        <div className="no-products-icon">
            <MdWarningAmber className="warning-icon" />
        </div>

        <h3 className="no-products-title">
            No Products Found
        </h3>

        <p className="no-products-message">
            {keyword
                ? `We Couldn't Find Any Products Matching "${keyword}". Try Using Different Keywords or Browse our Complete Collection.`
                : 'No Products Available at the Moment. Please Check Back Later.'}
        </p>
    </div>
  )
}

export default NoProduct
