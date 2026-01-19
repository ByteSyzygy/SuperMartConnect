import { useState, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { inventoryAPI, salesAPI, mpesaAPI } from '../api';
import socketService from '../socket';
import { session } from '../api';
import AddProductSection from "./AddProductComponent.jsx";


ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function AdminView() {
  const [activeTab, setActiveTab] = useState('inventory');
  const [inventory, setInventory] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counties, setCounties] = useState([]);
  const [mpesaTransactions, setMpesaTransactions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [restockAmount, setRestockAmount] = useState(10);
  const [editMode, setEditMode] = useState('restock'); // 'restock' or 'edit'
  const [editForm, setEditForm] = useState({ product: '', price: '', stock: '' });
  const [deletingItem, setDeletingItem] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [invResponse, salesResponse, countiesResponse] = await Promise.all([
        inventoryAPI.getAll(),
        salesAPI.getReport(),
        inventoryAPI.getCounties()
      ]);
      setInventory(invResponse.data);
      setSales(salesResponse.data);
      setCounties(countiesResponse.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMpesaTransactions = async () => {
    try {
      const response = await mpesaAPI.getTransactions();
      setMpesaTransactions(response.data);
    } catch (error) {
      console.error('Error fetching M-Pesa transactions:', error);
    }
  };

  // Auto-dismiss notifications after 4 seconds
  useEffect(() => {
    if (notifications.length > 0) {
      const timer = setTimeout(() => {
        setNotifications(prev => prev.slice(0, -1));
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  useEffect(() => {
    fetchData();
    fetchMpesaTransactions();

    // Setup WebSocket for real-time updates
    socketService.connect();
    socketService.joinAdmin();

    // Listen for inventory updates (sales)
    const handleInventoryUpdate = (data) => {
      const notification = {
        id: Date.now(),
        message: `Sale: ${data.product} (${data.branch}) - ${data.newStock} remaining`,
        type: 'sale'
      };
      setNotifications(prev => [notification, ...prev].slice(0, 5));
      fetchData();
    };

    // Listen for restock events
    const handleRestock = (data) => {
      const increase = data.newStock - data.oldStock;

      if (increase === 0 && !data.deleted) return;

      // Use the formatted message from server if available
      const notification = {
        id: Date.now(),
        message: data.message || (data.deleted
          ? `Delete Update: ${data.branch} ${data.product} has been removed from inventory.`
          : `Restock Update: ${data.branch} ${data.product} stock increased by ${increase}`),
        type: 'restock'
      };
      setNotifications(prev => [notification, ...prev].slice(0, 5));
      fetchData();
    };

    // Listen for M-Pesa callbacks
    const handleMpesaCallback = (data) => {
      const notification = {
        id: Date.now(),
        message: `M-Pesa ${data.status}: ${data.resultDesc}`,
        type: data.status === 'success' ? 'success' : 'error'
      };
      setNotifications(prev => [notification, ...prev].slice(0, 5));
      fetchMpesaTransactions();
    };

    socketService.on('inventory-updated', handleInventoryUpdate);
    socketService.on('stock-restocked', handleRestock);
    socketService.on('mpesa-callback', handleMpesaCallback);

    return () => {
      socketService.off('inventory-updated', handleInventoryUpdate);
      socketService.off('stock-restocked', handleRestock);
      socketService.off('mpesa-callback', handleMpesaCallback);
    };
  }, []);

  const handleRestock = async () => {
    if (!editingItem) return;
    const user = session.getUser();
    const adminName = user?.username || 'Unknown';
    try {
      await inventoryAPI.updateItem(editingItem.id, {
        stock: editingItem.stock + parseInt(restockAmount)
      });
      setEditingItem(null);
      fetchData();
      // The notification will come from WebSocket broadcast - no local notification needed
    } catch (error) {
      alert('Failed to update stock');
    }
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setEditMode('edit');
    setEditForm({
      product: item.product,
      price: item.price.toString(),
      stock: item.stock.toString()
    });
    setRestockAmount(10);
  };

  const openRestockModal = (item) => {
    setEditingItem(item);
    setEditMode('restock');
    setRestockAmount(10);
  };

  const handleEditItem = async () => {
    if (!editingItem) return;

    try {
      const updates = {};
      if (editForm.product !== editingItem.product) updates.product = editForm.product;
      if (parseFloat(editForm.price) !== editingItem.price) updates.price = parseFloat(editForm.price);
      if (parseInt(editForm.stock) !== editingItem.stock) updates.stock = parseInt(editForm.stock);

      if (Object.keys(updates).length === 0) {
        setEditingItem(null);
        return;
      }

      await inventoryAPI.updateItem(editingItem.id, updates);
      setEditingItem(null);
      fetchData();
      // The notification will come from WebSocket broadcast - no local notification needed
    } catch (error) {
      alert('Failed to update item');
    }
  };

  const handleDeleteItem = async () => {
    if (!deletingItem) return;

    try {
      await inventoryAPI.deleteItem(deletingItem.id);
      setDeletingItem(null);
      fetchData();
      // The notification will come from WebSocket broadcast - no local notification needed
    } catch (error) {
      alert('Failed to delete item');
    }
  };

  // Chart Data Preparation
  const prepareChartData = () => {
    const soldPerBrand = {};
    const incomePerBrand = {};

    sales.forEach(sale => {
      if (!soldPerBrand[sale.product]) {
        soldPerBrand[sale.product] = 0;
        incomePerBrand[sale.product] = 0;
      }
      soldPerBrand[sale.product] += sale.quantity;
      incomePerBrand[sale.product] += sale.total_amount;
    });

    return { soldPerBrand, incomePerBrand };
  };

  const chartData = prepareChartData();
  const totalIncome = Object.values(chartData.incomePerBrand).reduce((a, b) => a + b, 0);
  const totalSold = Object.values(chartData.soldPerBrand).reduce((a, b) => a + b, 0);
  const topProduct = Object.entries(chartData.soldPerBrand)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      y: { beginAtZero: true }
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications Toast - auto-dismisses after 4 seconds */}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`px-4 py-3 pr-8 rounded-lg shadow-lg transition-all duration-300 relative ${notif.type === 'sale' ? 'bg-blue-500' :
                  notif.type === 'restock' ? 'bg-green-500' :
                    notif.type === 'success' ? 'bg-green-500' : 'bg-red-500'
                } text-white text-sm`}
            >
              {notif.message}
              <button
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                className="absolute top-1 right-1 text-white/70 hover:text-white text-sm font-bold"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Headquarters Dashboard</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={fetchData}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full transition-colors"
            title="Refresh Data"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
          <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'inventory'
                  ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Inventory
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'reports'
                  ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Sales Reports
            </button>
            <button
              onClick={() => {
                setActiveTab('mpesa');
                fetchMpesaTransactions();
              }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'mpesa'
                  ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              M-Pesa
            </button>
            <button
              onClick={() => setActiveTab('counties')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'counties'
                  ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Counties
            </button>
            <button
              onClick={() => setActiveTab('add-product')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'add-product'
                  ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Add Product
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : (
        <>
          {activeTab === 'inventory' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden transition-colors duration-200">
              <div className="p-4 border-b dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Inventory Management</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white uppercase font-semibold text-xs border-b dark:border-gray-700">
                    <tr>
                      <th className="px-6 py-4">Branch</th>
                      <th className="px-6 py-4">Product</th>
                      <th className="px-6 py-4">Stock</th>
                      <th className="px-6 py-4">Price</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {inventory.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{item.branch}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${item.product === 'Coke' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                              item.product === 'Fanta' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' :
                                'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            }`}>
                            {item.product}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={item.stock < 10 ? 'text-red-600 dark:text-red-400 font-bold' : 'dark:text-gray-300'}>
                            {item.stock}
                          </span>
                        </td>
                        <td className="px-6 py-4">KES {item.price}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openRestockModal(item)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 font-medium hover:underline text-sm"
                            >
                              Restock
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button
                              onClick={() => openEditModal(item)}
                              className="text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 font-medium hover:underline text-sm"
                            >
                              Edit
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button
                              onClick={() => setDeletingItem(item)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 font-medium hover:underline text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/30">
                  <p className="text-blue-600 dark:text-blue-400 font-medium text-sm">Total Revenue</p>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
                    KES {totalIncome.toLocaleString()}
                  </h3>
                </div>
                <div className="card">
                  <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">Top Selling Product</p>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{topProduct}</h3>
                </div>
                <div className="card">
                  <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">Total Items Sold</p>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{totalSold}</h3>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Sales Volume by Brand</h3>
                  <div className="h-64">
                    <Bar
                      data={{
                        labels: Object.keys(chartData.soldPerBrand),
                        datasets: [{
                          label: 'Units Sold',
                          data: Object.values(chartData.soldPerBrand),
                          backgroundColor: [
                            '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'
                          ],
                          borderRadius: 6,
                        }]
                      }}
                      options={barOptions}
                    />
                  </div>
                </div>
                <div className="card">
                  <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Revenue by Brand</h3>
                  <div className="h-64">
                    <Bar
                      data={{
                        labels: Object.keys(chartData.incomePerBrand),
                        datasets: [{
                          label: 'Revenue (KES)',
                          data: Object.values(chartData.incomePerBrand),
                          backgroundColor: [
                            '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'
                          ],
                          borderRadius: 6,
                        }]
                      }}
                      options={barOptions}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mpesa' && (
            <MpesaSection transactions={mpesaTransactions} />
          )}

          {activeTab === 'counties' && (
            <CountiesSection counties={counties} onUpdate={fetchData} />
          )}

          {activeTab === 'add-product' && (
            <AddProductSection
              counties={counties}
              onProductAdded={fetchData}
            />
          )}
        </>
      )}

      {/* Restock/Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditingItem(null)}></div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm relative z-10 p-6 transition-colors duration-200">
            {editMode === 'restock' ? (
              <>
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Restock {editingItem.product}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                  Adding stock to <strong>{editingItem.branch}</strong> branch.
                  <br />Current Level: {editingItem.stock}
                </p>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity to Add</label>
                  <div className="flex items-center border dark:border-gray-600 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setRestockAmount(Math.max(1, restockAmount - 10))}
                      className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 border-r dark:border-gray-600 text-gray-600 dark:text-gray-300"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={restockAmount}
                      onChange={(e) => setRestockAmount(parseInt(e.target.value) || 0)}
                      className="flex-1 text-center py-2 focus:outline-none dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={() => setRestockAmount(restockAmount + 10)}
                      className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 border-l dark:border-gray-600 text-gray-600 dark:text-gray-300"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setEditingItem(null)}
                    className="flex-1 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRestock}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700"
                  >
                    Confirm Restock
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Edit {editingItem.product}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                  Editing item at <strong>{editingItem.branch}</strong> branch.
                </p>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product Name</label>
                    <input
                      type="text"
                      value={editForm.product}
                      onChange={(e) => setEditForm({ ...editForm, product: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price (KES)</label>
                    <input
                      type="number"
                      value={editForm.price}
                      onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock</label>
                    <input
                      type="number"
                      value={editForm.stock}
                      onChange={(e) => setEditForm({ ...editForm, stock: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setEditingItem(null)}
                    className="flex-1 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEditItem}
                    className="flex-1 bg-amber-600 text-white py-2 rounded-lg font-semibold hover:bg-amber-700"
                  >
                    Save Changes
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeletingItem(null)}></div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm relative z-10 p-6 transition-colors duration-200">
            <div className="text-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <h3 className="text-lg font-bold mb-2 text-gray-900 dark:text-white">Delete Item?</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                Are you sure you want to delete <strong>{deletingItem.product}</strong> from <strong>{deletingItem.branch}</strong> branch? This action cannot be undone.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingItem(null)}
                  className="flex-1 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteItem}
                  className="flex-1 bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MpesaSection({ transactions }) {
  const [configStatus, setConfigStatus] = useState(null);
  const [connectionTest, setConnectionTest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const fetchConfigStatus = async () => {
    try {
      const response = await mpesaAPI.getConfigStatus();
      setConfigStatus(response.data);
    } catch (error) {
      console.error('Error fetching M-Pesa config status:', error);
      setConfigStatus({ configured: false, error: 'Failed to fetch configuration' });
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const response = await mpesaAPI.testConnection();
      setConnectionTest(response.data);
    } catch (error) {
      setConnectionTest({
        success: false,
        message: error.response?.data?.message || 'Connection test failed',
        missingVariables: error.response?.data?.missingVariables,
        warnings: error.response?.data?.warnings
      });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    fetchConfigStatus();
  }, []);

  return (
    <div className="space-y-6">
      {/* M-Pesa Configuration Status */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden transition-colors duration-200">
        <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">M-Pesa Configuration Status</h2>
          <div className="flex gap-2">
            <button
              onClick={fetchConfigStatus}
              className="px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={testConnection}
              disabled={testing}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        ) : (
          <div className="p-4">
            {/* Status Indicator */}
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-4 h-4 rounded-full ${configStatus?.configured ? 'bg-green-500' : 'bg-red-500'
                }`}></div>
              <span className={`font-medium ${configStatus?.configured ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                {configStatus?.configured ? 'M-Pesa is configured' : 'M-Pesa is NOT configured'}
              </span>
            </div>

            {/* Connection Test Result */}
            {connectionTest && (
              <div className={`mb-4 p-3 rounded-lg ${connectionTest.success
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}>
                <div className="flex items-center gap-2">
                  {connectionTest.success ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600 dark:text-green-400">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600 dark:text-red-400">
                      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                  <span className={connectionTest.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}>
                    {connectionTest.message}
                  </span>
                </div>
                {connectionTest.hint && (
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 ml-7">
                    Hint: {connectionTest.hint}
                  </p>
                )}
              </div>
            )}

            {/* Configuration Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                <h4 className="font-medium text-gray-900 dark:text-white mb-2">Configuration Status</h4>
                <ul className="text-sm space-y-1">
                  <li className="flex items-center gap-2">
                    <span className={configStatus?.hasCredentials ? 'text-green-500' : 'text-red-500'}>
                      {configStatus?.hasCredentials ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-600 dark:text-gray-300">Credentials configured</span>
                  </li>
                  {configStatus?.shortcode && (
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-gray-600 dark:text-gray-300">Shortcode: {configStatus.shortcode}</span>
                    </li>
                  )}
                </ul>
              </div>

              {configStatus?.missingVariables?.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  <h4 className="font-medium text-red-700 dark:text-red-300 mb-2">Missing Configuration</h4>
                  <ul className="text-sm space-y-1">
                    {configStatus.missingVariables.map((v) => (
                      <li key={v} className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <span>✗</span>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {configStatus?.warnings?.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3">
                  <h4 className="font-medium text-yellow-700 dark:text-yellow-300 mb-2">Warnings</h4>
                  <ul className="text-sm space-y-1">
                    {configStatus.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-yellow-600 dark:text-yellow-400">
                        <span>⚠</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Setup Instructions Link */}
            {!configStatus?.configured && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>To fix this:</strong> See{' '}
                  <a href="MPESA_SETUP.md" className="underline hover:no-underline" target="_blank" rel="noopener noreferrer">
                    MPESA_SETUP.md
                  </a>{' '}for detailed instructions on configuring M-Pesa credentials.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transactions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden transition-colors duration-200">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">M-Pesa Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white uppercase font-semibold text-xs border-b dark:border-gray-700">
              <tr>
                <th className="px-6 py-4">Phone</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Branch</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                    No transactions yet
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-6 py-4">{tx.phone}</td>
                    <td className="px-6 py-4 font-medium">KES {tx.amount}</td>
                    <td className="px-6 py-4">{tx.branch || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tx.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                          tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                            'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">{new Date(tx.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CountiesSection({ counties, onUpdate }) {
  const [newCounty, setNewCounty] = useState({ name: '', latitude: '', longitude: '' });
  const [adding, setAdding] = useState(false);

  const handleAddCounty = async () => {
    if (!newCounty.name) return;
    try {
      await inventoryAPI.addCounty({
        name: newCounty.name,
        latitude: newCounty.latitude ? parseFloat(newCounty.latitude) : null,
        longitude: newCounty.longitude ? parseFloat(newCounty.longitude) : null
      });
      setNewCounty({ name: '', latitude: '', longitude: '' });
      setAdding(false);
      onUpdate();
    } catch (error) {
      alert('Failed to add county');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden transition-colors duration-200">
      <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Counties Management</h2>
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add County
        </button>
      </div>

      {adding && (
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
          <div className="flex gap-4 flex-wrap">
            <input
              type="text"
              placeholder="County Name"
              value={newCounty.name}
              onChange={(e) => setNewCounty({ ...newCounty, name: e.target.value })}
              className="px-3 py-2 border dark:border-gray-600 rounded dark:bg-gray-700"
            />
            <input
              type="number"
              placeholder="Latitude"
              value={newCounty.latitude}
              onChange={(e) => setNewCounty({ ...newCounty, latitude: e.target.value })}
              className="px-3 py-2 border dark:border-gray-600 rounded dark:bg-gray-700 w-32"
            />
            <input
              type="number"
              placeholder="Longitude"
              value={newCounty.longitude}
              onChange={(e) => setNewCounty({ ...newCounty, longitude: e.target.value })}
              className="px-3 py-2 border dark:border-gray-600 rounded dark:bg-gray-700 w-32"
            />
            <button
              onClick={handleAddCounty}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Save
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white uppercase font-semibold text-xs border-b dark:border-gray-700">
            <tr>
              <th className="px-6 py-4">ID</th>
              <th className="px-6 py-4">County Name</th>
              <th className="px-6 py-4">Latitude</th>
              <th className="px-6 py-4">Longitude</th>
              <th className="px-6 py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {counties.map((county) => (
              <tr key={county.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <td className="px-6 py-4">{county.id}</td>
                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{county.name}</td>
                <td className="px-6 py-4">{county.latitude || '-'}</td>
                <td className="px-6 py-4">{county.longitude || '-'}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${county.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                    {county.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

