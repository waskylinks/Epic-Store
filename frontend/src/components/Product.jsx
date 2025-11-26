import React from 'react'
import '../componentStyles/Product.css'
import { Link } from 'react-router-dom'

function Product({product}) {
    
  return (
    <Link to={product._id} className='product_id'>
    <div className="product-card">
        <img src={product.image[0].url} alt={product.name} />
        <div className="product-details">
            <h3 className="product-title">
                {product.name}
            </h3>
            <p className="product-price" style={{ color: '#0F1111'}}>
                <strong style={{ margin: '4px'}}>Price</strong>
                    {product.price}/-
            </p>
            <button className="add-to-cart">
                Add To Cart
            </button>
        </div>
    </div>
    </Link>
  )
}

export default Product