import {inventoryAPI} from "../api.js";
import {useState} from "react";

function AddProductSection({ counties, onProductAdded }) {
    const [formData, setFormData] = useState({
        product: '',
        branch: '',
        stock: '',
        price: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await inventoryAPI.addItem({
                product: formData.product.trim(),
                branch: formData.branch.trim(),
                stock: parseInt(formData.stock) || 0,
                price: parseFloat(formData.price) || 0
            });

            // Reset form
            setFormData({
                product: '',
                branch: '',
                stock: '',
                price: ''
            });

            // Callback to refresh inventory
            if (onProductAdded) onProductAdded();

            // Show success message (you could add a toast notification here)
            alert('Product added successfully!');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to add product. Please try again.');
            console.error('Add product error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden transition-colors duration-200">
            <div className="p-4 border-b dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add New Product</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Add a new product to inventory
                </p>
            </div>

            <div className="p-6">
                {error && (
                    <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Product Name */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Product Name *
                            </label>
                            <input
                                type="text"
                                name="product"
                                value={formData.product}
                                onChange={handleChange}
                                required
                                className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                placeholder="e.g., Coke, Fanta, Sprite"
                            />
                        </div>

                        {/* Branch Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Branch *
                            </label>
                            <select
                                name="branch"
                                value={formData.branch}
                                onChange={handleChange}
                                required
                                className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            >
                                <option value="">Select a branch</option>
                                {counties.map(county => (
                                    <option key={county.id} value={county.name}>
                                        {county.name}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Select from available counties
                            </p>
                        </div>

                        {/* Stock */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Initial Stock *
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    name="stock"
                                    value={formData.stock}
                                    onChange={handleChange}
                                    required
                                    min="0"
                                    className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                    placeholder="0"
                                />
                                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                                    units
                                </div>
                            </div>
                        </div>

                        {/* Price */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Price (KES) *
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                                    KES
                                </span>
                                <input
                                    type="number"
                                    name="price"
                                    value={formData.price}
                                    onChange={handleChange}
                                    required
                                    min="0"
                                    step="0.01"
                                    className="w-full pl-12 pr-3 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Form Actions */}
                    <div className="flex items-center justify-between pt-4 border-t dark:border-gray-700">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                            Fields marked with * are required
                        </div>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setFormData({
                                    product: '',
                                    branch: '',
                                    stock: '',
                                    price: ''
                                })}
                                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                disabled={loading}
                            >
                                Clear
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                        Adding...
                                    </>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                        </svg>
                                        Add Product
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>

                {/* Help Text */}
                <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">Guidelines</h3>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                        <li>• Product names should be consistent (e.g., always use "Coke" not "Coca-Cola")</li>
                        <li>• Branch names should follow your naming convention</li>
                        <li>• Initial stock should reflect current physical inventory</li>
                        <li>• Prices should be in Kenyan Shillings (KES)</li>
                        <li>• Adding a county is optional but recommended for better analytics</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default AddProductSection;