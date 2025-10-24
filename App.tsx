
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { FoodItem, CartItem, Order, CustomerDetails, PaymentMethod, OrderStatus } from './types';
import { supabase } from './supabaseClient';

// Context for managing application state
const AppContext = React.createContext<{
  loading: boolean;
  foodItems: FoodItem[];
  cart: CartItem[];
  orders: Order[];
  notifications: Order[];
  addFoodItem: (item: any) => Promise<void>;
  addToCart: (item: FoodItem) => void;
  updateCartQuantity: (itemId: string, quantity: number) => void;
  removeFromCart: (itemId: string) => void;
  clearCart: () => void;
  placeOrder: (customer: CustomerDetails, paymentMethod: PaymentMethod) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  clearNotifications: () => void;
}>({
  loading: true,
  foodItems: [],
  cart: [],
  orders: [],
  notifications: [],
  addFoodItem: async () => {},
  addToCart: () => {},
  updateCartQuantity: () => {},
  removeFromCart: () => {},
  clearCart: () => {},
  placeOrder: () => {},
  updateOrderStatus: async () => {},
  clearNotifications: () => {},
});

// Helper function to map Supabase food item row to frontend type
const mapFoodItemFromDb = (item: any): FoodItem => ({
  id: item.id,
  name: item.name,
  description: item.description,
  size: item.size,
  price: item.price,
  image1Url: item.image1_url,
  image2Url: item.image2_url,
  videoUrl: item.video_url,
});

// Helper function to map Supabase order row to frontend type
const mapOrderFromDb = (order: any): Order => ({
  id: order.id,
  customer: order.customer_details,
  items: order.items,
  total: order.total,
  paymentMethod: order.payment_method,
  timestamp: order.created_at,
  status: order.status,
  status_updated_at: order.status_updated_at,
});


// App Provider Component
const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<Order[]>([]);

  const fetchFoodItems = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('food_items').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching food items:', error.message);
    } else {
      setFoodItems(data.map(mapFoodItemFromDb));
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching orders:', error.message);
    } else {
      setOrders(data.map(mapOrderFromDb));
    }
  }, []);


  useEffect(() => {
    if (!supabase) {
        setLoading(false);
        return;
    };

    const fetchAllData = async () => {
        setLoading(true);
        await Promise.all([fetchFoodItems(), fetchOrders()]);
        setLoading(false);
    }
    fetchAllData();

    const channel = supabase.channel('custom-all-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
           if (payload.eventType === 'INSERT') {
            console.log('New order received!', payload);
            const newOrder = mapOrderFromDb(payload.new);
            setOrders(prev => [newOrder, ...prev]);
            setNotifications(prev => [newOrder, ...prev]);
           } else if (payload.eventType === 'UPDATE') {
             console.log('Order updated!', payload);
             const updatedOrder = mapOrderFromDb(payload.new);
             setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
           }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'food_items' },
        (payload) => {
            console.log('New food item from another client!', payload);
            const newItem = mapFoodItemFromDb(payload.new);
            setFoodItems(prev => {
              if (prev.some(item => item.id === newItem.id)) {
                return prev;
              }
              return [newItem, ...prev];
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchFoodItems, fetchOrders]);
  

  const addFoodItem = useCallback(async (item: any) => {
      if (!supabase) return;
      const uploadFile = async (file: File) => {
        if (!file) return null;
        const fileName = `${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage.from('food-media').upload(fileName, file);
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('food-media').getPublicUrl(fileName);
        return publicUrl;
      }
      
      const [image1Url, image2Url, videoUrl] = await Promise.all([
        uploadFile(item.image1File),
        uploadFile(item.image2File),
        uploadFile(item.videoFile),
      ]);
      
      const { data: insertedData, error } = await supabase.from('food_items').insert({
        name: item.name,
        description: item.description,
        size: item.size,
        price: item.price,
        image1_url: image1Url,
        image2_url: image2Url,
        video_url: videoUrl,
      }).select().single();

      if (error) {
        console.error("Error adding food item", error.message);
        throw error;
      }
      
      if (insertedData) {
        const newItem = mapFoodItemFromDb(insertedData);
        setFoodItems(prev => [newItem, ...prev]);
      }
  }, []);

  const addToCart = useCallback((item: FoodItem) => {
    setCart(prev => {
      const existingItem = prev.find(cartItem => cartItem.id === item.id);
      if (existingItem) {
        return prev.map(cartItem =>
          cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const updateCartQuantity = useCallback((itemId: string, quantity: number) => {
    setCart(prev =>
      prev
        .map(item => (item.id === itemId ? { ...item, quantity } : item))
        .filter(item => item.quantity > 0)
    );
  }, []);
  
  const removeFromCart = useCallback((itemId: string) => {
    setCart(prev => prev.filter(item => item.id !== itemId));
  }, []);


  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const placeOrder = useCallback(async (customer: CustomerDetails, paymentMethod: PaymentMethod) => {
    if (!supabase) return;
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const { error } = await supabase.from('orders').insert({
        customer_details: customer,
        items: cart,
        total,
        payment_method: paymentMethod,
        status: 'Pending', // Default status
    });

    if (error) {
      console.error("Error placing order:", error.message);
      alert(`Failed to place order: ${error.message}`);
    } else {
      setCart([]);
    }
  }, [cart]);
  
  const updateOrderStatus = useCallback(async (orderId: string, status: OrderStatus) => {
    if(!supabase) return;
    const { error } = await supabase
      .from('orders')
      .update({ status: status, status_updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if(error) {
      console.error("Error updating order status:", error.message);
      alert(`Failed to update status: ${error.message}`);
    } else {
       setOrders(prev => prev.map(o => o.id === orderId ? {...o, status: status} : o));
    }
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const value = useMemo(() => ({
    loading,
    foodItems,
    cart,
    orders,
    notifications,
    addFoodItem,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    placeOrder,
    updateOrderStatus,
    clearNotifications,
  }), [loading, foodItems, cart, orders, notifications, addFoodItem, addToCart, updateCartQuantity, removeFromCart, clearCart, placeOrder, updateOrderStatus, clearNotifications]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// Custom Hook to use AppContext
export const useAppContext = () => React.useContext(AppContext);

// --- Components ---

// Header Component
const Header: React.FC<{ setView: (view: View) => void }> = ({ setView }) => {
  const { cart, notifications, clearNotifications } = useAppContext();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleNotificationClick = () => {
    setIsNotifOpen(!isNotifOpen);
  };

  const viewOrder = (order: Order) => {
    setSelectedOrder(order);
    setIsNotifOpen(false); // Close dropdown when modal opens
  };
  
  const closeNotifAndClear = () => {
    setIsNotifOpen(false);
    clearNotifications();
  };

  return (
    <>
      <header className="bg-white shadow-md sticky top-0 z-50">
        <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl font-bold text-orange-600 cursor-pointer" onClick={() => setView('customer')}>
                  AreaBites
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button onClick={() => setView('customer')} className="text-gray-600 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium">Menu</button>
              <button onClick={() => setView('my-orders')} className="text-gray-600 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium">My Orders</button>
              <button onClick={() => setView('admin')} className="text-gray-600 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium">Admin</button>
              <div className="relative">
                <button onClick={handleNotificationClick} className="relative p-2 rounded-full text-gray-500 hover:text-orange-600 hover:bg-gray-100 focus:outline-none">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                  </svg>
                  {notifications.length > 0 && (
                    <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
                      {notifications.length}
                    </span>
                  )}
                </button>
                {isNotifOpen && (
                  <div className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <div className="py-1">
                      <div className="px-4 py-2 text-sm text-gray-700 font-semibold border-b">New Orders</div>
                      {notifications.length > 0 ? (
                        <>
                          <div className="max-h-60 overflow-y-auto">
                            {notifications.map(order => (
                              <div key={order.id} onClick={() => viewOrder(order)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">
                                New order from <span className="font-medium">{order.customer.name}</span> for ₹{order.total.toFixed(2)}
                              </div>
                            ))}
                          </div>
                          <div className="border-t">
                            <button onClick={closeNotifAndClear} className="block w-full text-center px-4 py-2 text-sm text-red-600 hover:bg-gray-100">Clear Notifications</button>
                          </div>
                        </>
                      ) : (
                        <div className="px-4 py-3 text-sm text-gray-500">No new notifications</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => setView('cart')} className="relative p-2 rounded-full text-gray-500 hover:text-orange-600 hover:bg-gray-100 focus:outline-none">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c.51 0 .962-.344 1.087-.835l1.823-6.84a1.125 1.125 0 0 0-.11-1.152A1.125 1.125 0 0 0 16.5 6H5.25L4.5 3.75m0 0L3.187 2.165A1.125 1.125 0 0 0 2.158 1.5H1.5" />
                </svg>
                {cartItemCount > 0 && (
                  <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
                    {cartItemCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </nav>
      </header>
      {selectedOrder && <OrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </>
  );
};

// Food Item Card
const FoodItemCard: React.FC<{ item: FoodItem }> = ({ item }) => {
  const { addToCart } = useAppContext();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      <div className="bg-white rounded-lg shadow-lg overflow-hidden transform transition-all hover:scale-105 duration-300">
        <img className="h-48 w-full object-cover cursor-pointer" src={item.image1Url} alt={item.name} onClick={() => setShowDetails(true)} />
        <div className="p-4">
          <h3 className="text-xl font-semibold text-gray-800 mb-1">{item.name}</h3>
          <p className="text-gray-600 text-sm mb-2 truncate">{item.description}</p>
          <div className="flex justify-between items-center mt-4">
            <span className="text-lg font-bold text-orange-600">₹{item.price}</span>
            <button
              onClick={() => addToCart(item)}
              className="px-4 py-2 bg-orange-500 text-white text-sm font-semibold rounded-lg hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600 focus:ring-opacity-50 transition-colors"
            >
              Add to Cart
            </button>
          </div>
        </div>
      </div>
      {showDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <div className="flex justify-between items-start">
                  <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{item.name}</h2>
                   <button onClick={() => setShowDetails(false)} className="text-gray-400 hover:text-gray-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
              </div>
              
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <img src={item.image1Url} alt={item.name} className="w-full h-auto rounded-lg object-cover" />
                  <img src={item.image2Url} alt={item.name} className="w-full h-auto rounded-lg object-cover" />
              </div>

              {item.videoUrl && (
                  <div className="mt-4">
                      <video controls className="w-full rounded-lg">
                          <source src={item.videoUrl} type="video/mp4" />
                          Your browser does not support the video tag.
                      </video>
                  </div>
              )}
              
              <p className="mt-4 text-gray-600">{item.description}</p>
              <div className="mt-6 flex justify-between items-center">
                  <span className="text-2xl font-bold text-orange-600">₹{item.price}</span>
                  <button
                      onClick={() => { addToCart(item); setShowDetails(false); }}
                      className="px-6 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600 focus:ring-opacity-50 transition-colors"
                  >
                      Add to Cart
                  </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Customer View
const CustomerView: React.FC = () => {
  const { foodItems } = useAppContext();
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Explore Our Menu</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {foodItems.map(item => <FoodItemCard key={item.id} item={item} />)}
      </div>
    </div>
  );
};


// Cart View
const CartView: React.FC<{ setView: (view: View) => void }> = ({ setView }) => {
  const { cart, updateCartQuantity, removeFromCart } = useAppContext();
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Your Cart</h1>
      {cart.length === 0 ? (
        <p className="text-gray-600">Your cart is empty. <span className="text-orange-500 cursor-pointer hover:underline" onClick={()=> setView('customer')}>Start ordering!</span></p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md">
            {cart.map(item => (
              <div key={item.id} className="flex items-center justify-between py-4 border-b last:border-b-0">
                <div className="flex items-center">
                  <img src={item.image1Url} alt={item.name} className="w-20 h-20 object-cover rounded-md mr-4"/>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-800">{item.name}</h3>
                    <p className="text-sm text-gray-500">₹{item.price}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center border rounded-md">
                      <button onClick={() => updateCartQuantity(item.id, item.quantity - 1)} className="px-3 py-1 text-gray-600 hover:bg-gray-100">-</button>
                      <span className="px-3 py-1">{item.quantity}</span>
                      <button onClick={() => updateCartQuantity(item.id, item.quantity + 1)} className="px-3 py-1 text-gray-600 hover:bg-gray-100">+</button>
                  </div>
                  <p className="font-semibold w-20 text-right">₹{item.price * item.quantity}</p>
                  <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-700">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md h-fit">
              <h2 className="text-xl font-semibold border-b pb-4">Order Summary</h2>
              <div className="flex justify-between mt-4">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-semibold">₹{total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between mt-2">
                  <span className="text-gray-600">Delivery</span>
                  <span className="font-semibold">Free</span>
              </div>
              <div className="flex justify-between mt-4 pt-4 border-t">
                  <span className="text-lg font-bold">Total</span>
                  <span className="text-lg font-bold">₹{total.toFixed(2)}</span>
              </div>
              <button onClick={() => setView('checkout')} className="w-full mt-6 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors">
                  Proceed to Checkout
              </button>
          </div>
        </div>
      )}
    </div>
  );
};


// Checkout View
const CheckoutView: React.FC<{ setView: (view: View) => void }> = ({ setView }) => {
    const { placeOrder } = useAppContext();
    const [customer, setCustomer] = useState<CustomerDetails>({ name: '', phone: '', address: '' });
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash on Delivery');
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if(customer.name && customer.phone && customer.address) {
            await placeOrder(customer, paymentMethod);
            alert('Order placed successfully!');
            setView('my-orders');
        } else {
            alert('Please fill all required fields.');
        }
    };

    return (
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Checkout</h1>
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md max-w-lg mx-auto">
                <h2 className="text-xl font-semibold mb-4">Delivery Information</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Full Name *</label>
                        <input type="text" id="name" value={customer.name} onChange={e => setCustomer({...customer, name: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-orange-500 focus:border-orange-500" required />
                    </div>
                    <div>
                        <label htmlFor="phone" className="block text-sm font-medium text-gray-700">Phone Number *</label>
                        <input type="tel" id="phone" value={customer.phone} onChange={e => setCustomer({...customer, phone: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-orange-500 focus:border-orange-500" required />
                    </div>
                    <div>
                        <label htmlFor="address" className="block text-sm font-medium text-gray-700">Address *</label>
                        <textarea id="address" value={customer.address} onChange={e => setCustomer({...customer, address: e.target.value})} rows={3} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-orange-500 focus:border-orange-500" required></textarea>
                    </div>
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email (Optional)</label>
                        <input type="email" id="email" value={customer.email} onChange={e => setCustomer({...customer, email: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
                    </div>
                </div>

                <h2 className="text-xl font-semibold mt-8 mb-4">Payment Method</h2>
                <div className="space-y-2">
                    {(['Cash on Delivery', 'Credit Card', 'UPI'] as PaymentMethod[]).map(method => (
                        <label key={method} className="flex items-center p-3 border rounded-md cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="payment" value={method} checked={paymentMethod === method} onChange={() => setPaymentMethod(method)} className="h-4 w-4 text-orange-600 border-gray-300 focus:ring-orange-500" />
                            <span className="ml-3 text-sm font-medium text-gray-700">{method}</span>
                        </label>
                    ))}
                </div>

                <button type="submit" className="w-full mt-8 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors">
                    Place Order
                </button>
            </form>
        </div>
    );
};


// Admin View
const AdminView: React.FC = () => {
    const { orders, addFoodItem, updateOrderStatus } = useAppContext();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newItem, setNewItem] = useState({ name: '', description: '', size: '', price: 0, image1File: null, image2File: null, videoFile: null });
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'image1File' | 'image2File' | 'videoFile') => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setNewItem(prev => ({ ...prev, [field]: file }));
        }
    };
    
    const handleStatusChange = (orderId: string, status: OrderStatus) => {
        updateOrderStatus(orderId, status);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newItem.name && newItem.description && newItem.size && newItem.price > 0 && newItem.image1File && newItem.image2File) {
            setIsSubmitting(true);
            try {
                await addFoodItem(newItem);
                setNewItem({ name: '', description: '', size: '', price: 0, image1File: null, image2File: null, videoFile: null });
                (e.target as HTMLFormElement).reset();
                alert('Food item added successfully!');
            } catch (error) {
                 alert('Failed to add food item. Please check the console for details.');
            } finally {
                setIsSubmitting(false);
            }
        } else {
            alert('Please fill all required fields and upload two images.');
        }
    };
    
    return (
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md h-fit">
                <h2 className="text-2xl font-bold mb-4">Add New Food Item</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" placeholder="Name" onChange={e => setNewItem(prev => ({ ...prev, name: e.target.value }))} className="w-full border p-2 rounded-md" required/>
                    <textarea placeholder="Description" onChange={e => setNewItem(prev => ({ ...prev, description: e.target.value }))} className="w-full border p-2 rounded-md" rows={3} required></textarea>
                    <input type="text" placeholder="Size (e.g., Medium)" onChange={e => setNewItem(prev => ({ ...prev, size: e.target.value }))} className="w-full border p-2 rounded-md" required/>
                    <input type="number" placeholder="Price" onChange={e => setNewItem(prev => ({ ...prev, price: parseFloat(e.target.value) }))} className="w-full border p-2 rounded-md" required/>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Image 1 *</label>
                        <input type="file" accept="image/*" onChange={e => handleFileChange(e, 'image1File')} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100" required/>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700">Image 2 *</label>
                        <input type="file" accept="image/*" onChange={e => handleFileChange(e, 'image2File')} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100" required/>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700">Video (Optional)</label>
                        <input type="file" accept="video/*" onChange={e => handleFileChange(e, 'videoFile')} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100" />
                    </div>
                    
                    <button type="submit" disabled={isSubmitting} className="w-full py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors disabled:bg-orange-300">
                        {isSubmitting ? 'Adding...' : 'Add Item'}
                    </button>
                </form>
            </div>
            <div className="lg:col-span-3 bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-4">All Orders</h2>
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                    {orders.length > 0 ? orders.map(order => (
                        <div key={order.id} className="border p-4 rounded-md hover:bg-gray-50">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-semibold cursor-pointer hover:text-orange-600" onClick={() => setSelectedOrder(order)}>{order.customer.name}</p>
                                    <p className="text-sm text-gray-500">{new Date(order.timestamp).toLocaleString()}</p>
                                    <p className="font-bold text-lg text-orange-600 mt-1">₹{order.total.toFixed(2)}</p>
                                </div>
                                <div className="text-right">
                                     <select 
                                        value={order.status} 
                                        onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                                        className="border-gray-300 rounded-md shadow-sm focus:border-orange-300 focus:ring focus:ring-orange-200 focus:ring-opacity-50"
                                     >
                                        {(['Pending', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled'] as OrderStatus[]).map(status => (
                                            <option key={status} value={status}>{status}</option>
                                        ))}
                                     </select>
                                </div>
                            </div>
                        </div>
                    )) : <p>No orders yet.</p>}
                </div>
            </div>
            {selectedOrder && <OrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
        </div>
    );
};

// Order Details Modal
const OrderDetailsModal: React.FC<{ order: Order; onClose: () => void }> = ({ order, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                    <div className="flex justify-between items-center border-b pb-3">
                        <h3 className="text-xl font-bold">Order Details</h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="mt-4 space-y-4">
                         <div>
                            <h4 className="font-semibold mb-2">Order Status</h4>
                            <OrderStatusTracker currentStatus={order.status} />
                        </div>
                        <div>
                            <h4 className="font-semibold">Customer Information</h4>
                            <p><strong>Name:</strong> {order.customer.name}</p>
                            <p><strong>Phone:</strong> {order.customer.phone}</p>
                            {order.customer.email && <p><strong>Email:</strong> {order.customer.email}</p>}
                            <p><strong>Address:</strong> {order.customer.address}</p>
                        </div>
                        <div>
                            <h4 className="font-semibold">Order Summary</h4>
                            <p><strong>Payment Method:</strong> {order.paymentMethod}</p>
                            <p><strong>Total:</strong> <span className="font-bold text-orange-600">₹{order.total.toFixed(2)}</span></p>
                        </div>
                        <div>
                            <h4 className="font-semibold">Items Ordered</h4>
                            <ul className="list-disc list-inside space-y-1 mt-2">
                                {order.items.map(item => (
                                    <li key={item.id}>{item.quantity} x {item.name}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const OrderStatusTracker: React.FC<{ currentStatus: OrderStatus }> = ({ currentStatus }) => {
    const statuses: OrderStatus[] = ['Pending', 'Preparing', 'Out for Delivery', 'Delivered'];
    const currentIndex = statuses.indexOf(currentStatus);

    if(currentStatus === 'Cancelled') {
        return (
            <div className="flex items-center justify-center p-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-md">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="font-semibold">This order has been cancelled.</p>
            </div>
        );
    }
    
    return (
        <div className="flex items-center justify-between">
            {statuses.map((status, index) => (
                <React.Fragment key={status}>
                    <div className="flex flex-col items-center text-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${index <= currentIndex ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                           {index < currentIndex ? '✓' : index + 1}
                        </div>
                        <p className={`text-xs mt-1 ${index <= currentIndex ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>{status}</p>
                    </div>
                    {index < statuses.length - 1 && (
                        <div className={`flex-1 h-1 mx-2 ${index < currentIndex ? 'bg-orange-500' : 'bg-gray-200'}`}></div>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};

// My Orders View (New Component)
const MyOrdersView: React.FC<{setView: (view: View) => void}> = ({setView}) => {
    const { orders } = useAppContext();

    return (
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">My Orders</h1>
            {orders.length === 0 ? (
                <p className="text-gray-600">You haven't placed any orders yet. <span className="text-orange-500 cursor-pointer hover:underline" onClick={()=> setView('customer')}>Start ordering!</span></p>
            ) : (
                <div className="space-y-6">
                    {orders.map(order => (
                        <div key={order.id} className="bg-white p-6 rounded-lg shadow-md">
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b pb-4 mb-4">
                                <div>
                                    <p className="text-sm text-gray-500">Order ID: {order.id.substring(0,8)}...</p>
                                    <p className="text-sm text-gray-500">Placed on: {new Date(order.timestamp).toLocaleString()}</p>
                                </div>
                                <p className="font-bold text-xl text-orange-600 mt-2 sm:mt-0">₹{order.total.toFixed(2)}</p>
                            </div>
                            <div className="mb-4">
                                <h4 className="font-semibold mb-3">Items</h4>
                                <div className="flex space-x-2">
                                {order.items.slice(0, 5).map(item => (
                                     <div key={item.id} className="relative group">
                                        <img src={item.image1Url} alt={item.name} className="w-12 h-12 object-cover rounded-md"/>
                                        <div className="absolute bottom-full mb-2 hidden group-hover:block w-max bg-gray-800 text-white text-xs rounded py-1 px-2">
                                            {item.quantity} x {item.name}
                                        </div>
                                    </div>
                                ))}
                                {order.items.length > 5 && (
                                    <div className="w-12 h-12 rounded-md bg-gray-200 flex items-center justify-center text-sm font-semibold">
                                        +{order.items.length - 5}
                                    </div>
                                )}
                                </div>
                            </div>
                            <OrderStatusTracker currentStatus={order.status} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


type View = 'customer' | 'cart' | 'checkout' | 'admin' | 'my-orders';

function App() {
  const [view, setView] = useState<View>('customer');

  if (!supabase) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="p-8 bg-white rounded-lg shadow-xl text-center max-w-lg w-full">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Configuration Error</h1>
          <p className="text-gray-700 mb-3">
            Supabase is not configured correctly. The application cannot connect to the database.
          </p>
          <p className="text-gray-700 mb-6">
            Please open the file <code className="bg-gray-200 text-gray-800 p-1 rounded font-mono text-sm">supabaseClient.ts</code> and replace the placeholder values for <code className="bg-gray-200 text-gray-800 p-1 rounded font-mono text-sm">supabaseUrl</code> and <code className="bg-gray-200 text-gray-800 p-1 rounded font-mono text-sm">supabaseAnonKey</code> with your actual Supabase project credentials.
          </p>
          <div className="bg-orange-50 border-l-4 border-orange-400 text-orange-700 p-4 text-left" role="alert">
            <p className="font-bold">Important (महत्वपूर्ण)</p>
            <p>You can find this information in your Supabase project's "Settings" &gt; "API" section.</p>
            <p>आपको यह जानकारी आपके Supabase प्रोजेक्ट की सेटिंग्स के "API" सेक्शन में मिलेगी।</p>
          </div>
        </div>
      </div>
    );
  }

  const renderView = (loading: boolean) => {
    if (loading) {
        return <div className="flex justify-center items-center h-64"><p className="text-xl text-gray-500">Loading data...</p></div>;
    }
    switch(view) {
      case 'cart':
        return <CartView setView={setView} />;
      case 'checkout':
        return <CheckoutView setView={setView} />;
      case 'admin':
        return <AdminView />;
      case 'my-orders':
        return <MyOrdersView setView={setView}/>;
      case 'customer':
      default:
        return <CustomerView />;
    }
  }

  return (
    <AppProvider>
      <AppContext.Consumer>
        {({ loading }) => (
          <div className="min-h-screen bg-gray-50">
            <Header setView={setView} />
            <main>
              {renderView(loading)}
            </main>
          </div>
        )}
      </AppContext.Consumer>
    </AppProvider>
  );
}

export default App;