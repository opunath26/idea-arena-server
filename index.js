const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);


const port = process.env.PORT || 3000

const crypto = require("crypto");

function generateTrackingId(){
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();


    return `${prefix}-$date-${random}`;
}

// middleware
app.use(express.json());
app.use(cors());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q4baesu.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('idea_arena_db');
        const contestsCollection = db.collection('contests');
        const paymentCollection = db.collection('payment');


        // contests api
        app.get('/contests', async (req, res) => {
            const query = {}
            const { email } = req.query;

            if (email) {
                query.creatorEmail = email;
            }

            const options = { sort: { createAt: -1 } }

            const cursor = contestsCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/contests/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await contestsCollection.findOne(query);
            res.send(result);
        })

        app.post('/contests', async (req, res) => {
            const contest = req.body;
            // contest created time
            contest.createAt = new Date();

            const result = await contestsCollection.insertOne(contest);
            res.send(result)
        })

        app.delete("/contests/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await contestsCollection.deleteOne(query);
            res.send(result);
        });


        // PAYMENTS 
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.contestCreationFee) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for: ${paymentInfo.contestTitle}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                customer_email: paymentInfo.creatorEmail,
                metadata: {
                    contestId: paymentInfo.contestId
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            res.send({ url: session.url })

        })

        // old
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.contestCreationFee) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.contestTitle
                            }
                        },
                        quantity: 1,
                    },
                ],

                customer_email: paymentInfo.creatorEmail,
                mode: 'payment',
                metadata: {
                    contestId: paymentInfo.contestId,
                    contestTitle: paymentInfo.contestTitle
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            console.log(session)
            res.send({ url: session.url })

        })

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            console.log('session retrieve', session);
            const trackingId = generateTrackingId()

            if (session.payment_status === 'paid') {
                const id = session.metadata.contestId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId
                    }
                }

                const result = await contestsCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    session: session.currency,
                    customerEmail: session.customer_email,
                    contestId: session.metadata.contestId,
                    contestTitle: session.metadata.contestTitle,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date()
                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment)

                    res.send({ success: true, 
                        modifyContest: result,
                        trackingId: trackingId,
                        transactionId: session.payment_intent,
                        paymentInfo: resultPayment })
                }
            }

            res.send({ success: false })
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('idea arena contest is start')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})