const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000
const crypto = require("crypto");

const admin = require("firebase-admin");


admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
});


function generateTrackingId() {
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();


    return `${prefix}-${date}-${random}`;
}

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(404).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


}

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
        const userCollection = db.collection('users');
        const contestsCollection = db.collection('contests');
        const paymentCollection = db.collection('payment');
        const candidatesCollection = db.collection('candidates');
        const trackingCollection = db.collection('trackings');

        // middle admin before allowing admin activity
        // must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }

        const logTracking = async (trackingId, status) => {
            const log = {
                trackingId,
                status,
                details: status.split('-').join(' '),
                createdAt: new Date()
            }
            const result = await trackingCollection.insertOne(log);
            return result;
        }


        // users related apis
        app.get('/users', verifyFBToken, async (req, res) => {

            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                // query.displayName = {$regex: searchText, $options: 'i' }

                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } }
                ]
            }

            const cursor = userCollection.find(query).sort({ createdAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.findOne(query);
            res.send(result);
        })

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await userCollection.findOne(query);
            res.send({ role: user?.role || 'user' });
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await userCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists' })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result);
        })



        // contests api
        app.get('/contests', async (req, res) => {
            const query = {};
            const { email, submitStatus, search, contestType, limit } = req.query;

            if (email) query.creatorEmail = email;


            if (submitStatus) query.submitStatus = submitStatus;

            if (search) {
                query.$or = [
                    { contestTitle: { $regex: search, $options: 'i' } },
                    { contestType: { $regex: search, $options: 'i' } }
                ];
            }

            const cursor = contestsCollection.find(query).sort({ createdAt: -1 });
            if (limit) cursor.limit(parseInt(limit));

            const result = await cursor.toArray();
            res.send(result);
        });

        app.get('/contests/candidate', async (req, res) => {
            const { candidateEmail, submitStatus } = req.query;
            const query = {}
            if (candidateEmail) {
                query.candidateEmail = candidateEmail
            }
            if (submitStatus !== 'prize-delivered') {
                // query.submitStatus = {$in: ['candidate-assigned', 'submission-approved']}
                query.submitStatus = { $nin: ['prize-delivered'] }
            }
            else {
                query.submitStatus = submitStatus;
            }

            const cursor = contestsCollection.find(query);
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

        // TODO: rename this to be specific like /contests/:id/assigned
        app.patch('/contests/:id', async (req, res) => {
            const { candidateId, candidateName, candidateEmail, trackingId } = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    submitStatus: 'candidate-assigned',
                    candidateId: candidateId,
                    candidateName: candidateName,
                    candidateEmail: candidateEmail
                }
            }
            const result = await contestsCollection.updateOne(query, updateDoc);

            // update candidate information
            const candidateQuery = { _id: new ObjectId(candidateId) }
            const candidateUpdateDoc = {
                $set: {
                    workStatus: 'assigned'
                }
            }
            const candidateResult = await candidatesCollection.updateOne(candidateQuery, candidateUpdateDoc);

            // log tracking
            logTracking(trackingId, 'candidate-assigned')


            res.send(candidateResult);
        })

        app.patch('/contests/:id/status', async (req, res) => {
            const { submitStatus, candidateId, trackingId } = req.body;
            const query = { _id: new ObjectId(req.params.id) }
            const updatedDoc = {
                $set: {
                    submitStatus: submitStatus
                }
            }

            if (submitStatus === 'prize-delivered') {
                // update candidate information
                const candidateQuery = { _id: new ObjectId(candidateId) }
                const candidateUpdateDoc = {
                    $set: {
                        workStatus: 'available'
                    }
                }
                const candidateResult = await candidatesCollection.updateOne(candidateQuery, candidateUpdateDoc);
            }


            const result = await contestsCollection.updateOne(query, updatedDoc);
            // log tracking
            logTracking(trackingId, submitStatus);

            res.send(result);

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
            if (!sessionId) return res.status(400).send({ message: 'Session ID missing' });

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query);
            if (paymentExist) {
                return res.send({
                    message: 'already exists',
                    transactionId,
                    trackingId: paymentExist.trackingId
                })
            }

            const trackingId = generateTrackingId()

            if (session.payment_status === 'paid') {
                const id = session.metadata.contestId;
                const query = { _id: new ObjectId(id) }


                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        submitStatus: 'submit-done',
                        trackingId: trackingId
                    },
                    $inc: {
                        participantsCount: 1
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
                    paidAt: new Date(),
                    trackingId: trackingId
                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment);

                    logTracking(trackingId, 'submit-done')

                    return res.send({
                        success: true,
                        modifyContest: result,
                        trackingId: trackingId,
                        transactionId: session.payment_intent,
                        paymentInfo: resultPayment
                    })
                }
            }

            res.send({ success: false })
        })

        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}

            // console.log( 'headers', req.headers);


            if (email) {
                query.customerEmail = email

                // check email address
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })


        // Admin Dashboard
        app.get('/admin-stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {

                const totalUsers = await userCollection.countDocuments();


                const totalContests = await contestsCollection.countDocuments();


                const pendingContests = await contestsCollection.countDocuments({ submitStatus: 'pending' });


                const payments = await paymentCollection.find().toArray();
                const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

                res.send({
                    totalUsers,
                    totalContests,
                    pendingContests,
                    totalRevenue
                });
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // Candidates related apis
        app.get('/candidates', async (req, res) => {
            const { status, contestType, workStatus } = req.query;
            const query = {}

            if (status) {
                query.status = status;
            }
            if (contestType) {
                query.contestType = contestType;
            }
            if (workStatus) {
                query.workStatus = workStatus;
            }

            const cursor = candidatesCollection.find(query)
            const result = await cursor.toArray();
            res.send(result);
        })

        app.post('/candidates', async (req, res) => {
            const candidate = req.body;
            candidate.status = 'pending';
            candidate.createdAt = new Date();

            const result = await candidatesCollection.insertOne(candidate);
            res.send(result);
        })

        app.patch('/candidates/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }

            const result = await candidatesCollection.updateOne(query, updateDoc);

            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'candidate'
                    }
                }
                const userResult = await userCollection.updateOne(userQuery, updateUser);
            }

            res.send(result);
        })

        app.delete('/candidates/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await candidatesCollection.deleteOne(query);
            res.send(result);
        });
        // trackings related apis
        app.get('/trackings/:trackingId/logs', async (req, res) => {
            const trackingId = req.params.trackingId;
            const query = { trackingId }
            const result = await trackingCollection.find(query).toArray();
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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