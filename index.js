const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);


const port = process.env.PORT || 3000

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


        // payment
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.contestCreationFee) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
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
                    contestId: paymentInfo.contestId
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            console.log(session)
            res.send({ url: session.url })

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
