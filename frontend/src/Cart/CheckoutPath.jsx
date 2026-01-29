import React from 'react';
import '../CartStyles/CheckoutPath.css';
import { FiTruck, FiCheckCircle, FiCreditCard, FiCheck } from 'react-icons/fi';

function CheckoutPath({ activePath }) {
  const steps = [
    {
      label: 'Shipping',
      icon: <FiTruck />,
      description: 'Delivery address'
    },
    {
      label: 'Confirm',
      icon: <FiCheckCircle />,
      description: 'Review order'
    },
    {
      label: 'Payment',
      icon: <FiCreditCard />,
      description: 'Complete purchase'
    },
  ];

  return (
    <div className="cp-container">
      <div className="cp-wrapper">
        {steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="cp-step-wrapper">
              <div 
                className={`cp-step ${
                  activePath === index ? 'cp-active' : ''
                } ${activePath > index ? 'cp-completed' : ''}`}
              >
                <div className="cp-icon-container">
                  {activePath > index ? (
                    <div className="cp-check-icon">
                      <FiCheck />
                    </div>
                  ) : (
                    <div className="cp-step-icon">
                      {step.icon}
                    </div>
                  )}
                  <div className="cp-step-number">{index + 1}</div>
                </div>
                
                <div className="cp-step-content">
                  <h3 className="cp-step-label">{step.label}</h3>
                  <p className="cp-step-description">{step.description}</p>
                </div>
              </div>
            </div>

            {index < steps.length - 1 && (
              <div className="cp-connector-wrapper">
                <div 
                  className={`cp-connector ${
                    activePath > index ? 'cp-connector-completed' : ''
                  }`}
                >
                  <div className="cp-connector-progress"></div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default CheckoutPath;