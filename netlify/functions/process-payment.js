const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'bitser'
    });
}

const db = admin.firestore();

exports.handler = async (event, context) => {
    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Parse the incoming webhook data
        const data = JSON.parse(event.body);
        
        console.log('Webhook received:', JSON.stringify(data, null, 2));

        // QRIS.PW webhook data structure
        // Expected fields: order_id, status, amount, etc.
        const { order_id, status, amount } = data;

        // Validate required fields
        if (!order_id || !status) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        // Extract userId from order_id (format: UID_TIMESTAMP)
        const orderParts = order_id.split('_');
        if (orderParts.length < 2) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid order_id format' })
            };
        }

        const userId = orderParts[0];

        // Check if payment is successful
        if (status === 'PAID' || status === 'SUCCESS' || status === 'paid' || status === 'success') {
            
            // Find the transaction by orderId
            const transactionsRef = db.collection('transactions');
            const snapshot = await transactionsRef
                .where('orderId', '==', order_id)
                .where('status', '==', 'pending')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('No pending transaction found for order:', order_id);
                return {
                    statusCode: 404,
                    body: JSON.stringify({ error: 'Transaction not found' })
                };
            }

            // Get the transaction document
            const transactionDoc = snapshot.docs[0];
            const transactionData = transactionDoc.data();
            const transactionAmount = amount || transactionData.amount;

            // Update transaction status
            await transactionDoc.ref.update({
                status: 'completed',
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                paidAmount: transactionAmount
            });

            // Update user balance
            const userRef = db.collection('users').doc(userId);
            await userRef.update({
                coinBalance: admin.firestore.FieldValue.increment(transactionAmount)
            });

            console.log(`Successfully updated balance for user ${userId}. Amount: ${transactionAmount}`);

            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'Payment processed successfully',
                    userId: userId,
                    amount: transactionAmount
                })
            };
        } 
        else if (status === 'EXPIRED' || status === 'FAILED' || status === 'expired' || status === 'failed') {
            // Handle failed/expired payment
            const transactionsRef = db.collection('transactions');
            const snapshot = await transactionsRef
                .where('orderId', '==', order_id)
                .where('status', '==', 'pending')
                .limit(1)
                .get();

            if (!snapshot.empty) {
                const transactionDoc = snapshot.docs[0];
                await transactionDoc.ref.update({
                    status: 'failed',
                    failedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Payment failed or expired' 
                })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: false, 
                message: 'Unknown payment status' 
            })
        };

    } catch (error) {
        console.error('Error processing webhook:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            })
        };
    }
};
