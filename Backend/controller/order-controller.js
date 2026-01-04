import Order from '../models/order-model.js';
import Product from '../models/product-model.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import { deleteCachePattern } from '../utils/redis.js';

// Helper: Invalidate analytics caches
const invalidateAnalyticsCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
        // Don't block the request if cache fails
    }
};

//create new order
export const createNewOrder = handleAsyncError(async (req, res, next) => {
    const { shippingInfo, orderItems, paymentInfo, itemPrice, taxPrice, shippingPrice, totalPrice } = req.body;

    const order = await Order.create({
        shippingInfo,
        orderItems,
        paymentInfo,
        itemPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        paidAt: Date.now(),
        user: req.user._id
    });

    // Invalidate caches after creating order
    await invalidateAnalyticsCaches();

    res.status(200).json({
        success: true,
        order
    });
});

//all orders 
export const allMyOrders = handleAsyncError(async (req, res, next) => {
    const orders = await Order.find({
        user: req.user._id
    });
    if(!orders) {
        return next(new HandleError('No order found', 404));
    }

    res.status(200).json({
        success: true,
        orders
    })
});

//admin- getting single order
export const getSingleOrder = handleAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id).populate('user', 'name email')
    if(!order) {
        return next(new HandleError('No order found', 404));
    }

    res.status(200).json({
        success: true,
        order
    });
});

// admin- getting all orders placed by users
export const getAllOrders = handleAsyncError(async (req, res, next) => {
    const orders = await Order.find().populate('user', 'name email');

    let totalAmount = 0;
    orders.forEach(order => {
        totalAmount += order.totalPrice;
    });

    res.status(200).json({
        success: true,
        orders,
        totalAmount
    });
});

// admin- update order status
export const updateOrderStatus = handleAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        return next(new HandleError('Order not found', 404));
    }

    if (order.orderStatus === 'Delivered') {
        return next(new HandleError("This order has already been delivered", 400));
    }

    // Allow Cancelled + other statuses
    const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!req.body.status || !validStatuses.includes(req.body.status)) {
        return next(new HandleError('Invalid order status', 400));
    }

    // Restore stock if cancelling
    if (req.body.status === 'Cancelled') {
        try {
            await Promise.all(
                order.orderItems.map(async (item) => {
                    const product = await Product.findById(item.product);
                    if (product) {
                        product.stock += item.quantity;
                        await product.save({ validateBeforeSave: false });
                    }
                })
            );
        } catch (error) {
            return next(error);
        }
    }

    // Deduct stock only on delivery
    if (req.body.status === 'Delivered') {
        try {
            await Promise.all(
                order.orderItems.map(async (item) => {
                    await updateQuantity(item.product.toString(), item.quantity);
                })
            );
            order.deliveredAt = Date.now();
        } catch (error) {
            return next(error);
        }
    }

    order.orderStatus = req.body.status;
    await order.save({ validateBeforeSave: false });

    // Invalidate caches after updating order status
    await invalidateAnalyticsCaches();

    res.status(200).json({
        success: true,
        order
    });
});

async function updateQuantity(id, quantity) {
    const product = await Product.findById(id);

    if (!product) {
        throw new HandleError(`Product not found with id: ${id}`, 404);
    }

    if (product.stock < quantity) {
        throw new HandleError(`Only ${product.stock} units available for ${product.name}`, 400);
    }

    product.stock -= quantity;
    await product.save({ validateBeforeSave: false });
}

// Delete order 
export const deleteOrder = handleAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        return next(new HandleError("Order not found", 404));
    }

    if (order.orderStatus !== 'Delivered') {
        return next(new HandleError("Cannot delete order that is not delivered", 400));
    }

    await Order.findByIdAndDelete(req.params.id);

    // Invalidate caches after deleting order
    await invalidateAnalyticsCaches();

    res.status(200).json({
        success: true,
        message: 'Order deleted successfully'
    });
});