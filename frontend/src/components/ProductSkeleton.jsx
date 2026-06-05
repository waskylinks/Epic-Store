import React from 'react';
import '../componentStyles/ProductSkeleton.css';

function ProductSkeleton() {
    return (
        <div className="pc-card pc-card--skeleton">
            <div className="sk-image-wrap">
                <div className="sk-pulse sk-image" />
                <div className="sk-badge-group">
                    <div className="sk-pulse sk-badge" />
                </div>
            </div>
            <div className="pc-info sk-info">
                <div className="sk-meta-row">
                    <div className="sk-pulse sk-brand" />
                    <div className="sk-pulse sk-cat" />
                </div>
                <div className="sk-name-wrap">
                    <div className="sk-pulse sk-name-l1" />
                    <div className="sk-pulse sk-name-l2" />
                </div>
                <div className="sk-stars-row">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="sk-pulse sk-star" />
                    ))}
                    <div className="sk-pulse sk-rc" />
                </div>
                <div className="sk-price-row">
                    <div className="sk-pulse sk-price-main" />
                    <div className="sk-pulse sk-price-old" />
                </div>
                <div className="sk-footer-row">
                    <div className="sk-pulse sk-stock" />
                    <div className="sk-pulse sk-btn" />
                </div>
            </div>
        </div>
    );
}

export default ProductSkeleton;