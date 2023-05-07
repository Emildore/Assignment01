require("./utils.js")

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;

const port = process.env.PORT || 3000;

const app = express();

const Joi = require('joi');

const expireTime = 1000 * 60 * 60 ; // 1 Hour

/* Secret information section */
const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_database = process.env.MONGODB_DATABASE;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;
/* End secret information section */

var {database} = include('databaseConnection');

const userCollection = database.db(mongodb_database).collection("users");

app.set('view engine', 'ejs');

app.use(express.urlencoded({extended: false}));

var mongoStore = MongoStore.create({
    mongoUrl: `mongodb+srv://${mongodb_user}:${mongodb_password}@${mongodb_host}/test`,
    crypto: {
        secret: mongodb_session_secret
    }
})

app.use(session({
    secret: node_session_secret,
        store: mongoStore, //default is memory store
        saveUninitialized: false,
        resave: true
}
));

app.get('/', (req, res) => {
    res.render('index', {authenticated: req.session.authenticated, user_type: req.session.user_type, req: req});
});

app.get('/signUp', (req,res) => {
    let error = req.query.error;
    res.render('signUp', {error: error, authenticated: req.session.authenticated, req: req});
});

app.post('/submitUser', async (req,res) => {
    var username = req.body.username;
    var password = req.body.password;
    var email = req.body.email;

    const queryParams = [];
    if (!username) {
        queryParams.push("blankUsername=true");
    }

    if (!password) {
        queryParams.push("blankPassword=true");
    }

    if (!email) {
        queryParams.push("blankEmail=true");
    }

    if (queryParams.length > 0) {
        res.redirect(`/signUp?${queryParams.join('&')}`);
        return;
    }

    // Joi validation to check if the submitted username, password, and email meet specific requirements when signing up a new user.
    const schema = Joi.object(
        {
        username: Joi.string().alphanum().max(20).required(),
        password: Joi.string().regex(/^(?=.*[!@#$%^&*])(?=.*[A-Z])(?=.*[0-9])(?=.{6,})/).required(),
        email: Joi.string().email().required()
        }
    );

    // Joi validation to check if the submitted username, password, and email meet specific requirements when signing up a new user.
    const validationResult = schema.validate({username, password, email});
    if (validationResult.error != null) {
        console.log(validationResult.error);
        res.redirect('/signUp?error=password');
        return;
    }

    const existingUser = await userCollection.findOne({
        $or: [
          { username: { $regex: new RegExp(`^${username}$`, "i") } }, // case-insensitive match for username
          { email: { $regex: new RegExp(`^${email}$`, "i") } } // case-insensitive match for email
        ]
    });

    if (existingUser) {
        if (existingUser.username.toLowerCase() === username.toLowerCase()) {
        res.redirect('/signUp?error=username');
        return;
        } else {
        res.redirect('/signUp?error=email');
        return;
        }
    }

    var hashedPassword = await bcrypt.hash(password, saltRounds);
        await userCollection.insertOne({username: username, password: hashedPassword, email: email, userType: "user"});
        console.log("inserted user");

    req.session.authenticated = true;
    req.session.username = username;
    req.session.message = `Successfully Signed Up: ${username}.`;
    req.session.justSignedUp = true; // set flag to indicate that the user just signed up

    // redirect to members page
    res.redirect('/members');
});

app.get('/login', (req,res) => {
    if (req.session.authenticated) { // Check if session exists
        return res.redirect('/members'); // Redirect to members page
    }

    res.render('login', { authenticated: req.session.authenticated, req: req });
});

app.post('/loggingIn', async (req,res) => {
    var identifier = req.body.identifier;
    var password = req.body.password;

    const blankFields = [];
    if (!identifier) {
        blankFields.push("identifier");
    }

    if (!password) {
        blankFields.push("password");
    }

    if (blankFields.length > 0) {
        res.redirect(`/login?blankFields=${blankFields.join(',')}`);
        return;
    }

    // Joi validation to check if the submitted identifier (username or email) meets specific requirements when logging in.
    const schema = Joi.string().max(20).required();
    const validationResult = schema.validate(identifier);
    if (validationResult.error != null) {
        console.log(validationResult.error);
        res.redirect('/login?blankFields=true');
        return;
    }

    let query;
    if (identifier.includes('@')) { // Check if the identifier is an email
        query = { email: identifier };
    } else {
        query = { username: identifier };
    }

    const result = await userCollection
        .find(query)
        .project({username: 1, password: 1,user_type: 1, _id: 1})
        .toArray();
    console.log(result);
    
    if (result.length != 1) {
        console.log("User Not Found");
        res.redirect('/login?loginError=true');
        return;
    }

    //set session variables
    if (await bcrypt.compare(password, result[0].password)) {
        console.log("Correct password");
        req.session.authenticated = true;
        req.session.username = result[0].username;
        req.session.user_type = result[0].user_type;
        req.session.cookie.maxAge = expireTime;

        res.redirect('/members');
        return;
    } else {
        console.log("Incorrect password");
        res.redirect('/login?loginError=true');
        return;
    }
});

app.get('/members', sessionValidation, (req,res) => {

    // Array of image URLs
    const images = [
    '/Cat1.jpg',
    '/Cat2.jpg',
    '/Cat3.jpg'
    ];

    // Render the members.ejs template with the necessary variables
    res.render('members', {
        username: req.session.username,
        justSignedUp: req.session.justSignedUp,
        images: images,
        user_type: req.session.user_type,
        authenticated: req.session.authenticated,
        req: req 
    });

    // Reset the justSignedUp flag
    req.session.justSignedUp = false;
});

function isValidSession(req) {
    if (req.session.authenticated) {
        return true;
    }
    return false;
}

function sessionValidation(req,res,next) {
    if (isValidSession(req)) {
        next();
    }
    else {
        res.redirect('/login?notLoggedIn=true');
    }
}


function isAdmin(req) {
    if (req.session.user_type == 'admin') {
        return true;
    }
    return false;
}

function adminAuthorization(req, res, next) {
    if (!req.session.authenticated) {
        res.redirect('/login');
        return;
    }

    if (!isAdmin(req)) {
        res.status(403);
        res.render("adminNotAuth", {error: 'You are not authorized to view this page', authenticated: req.session.authenticated,
        user_type: req.session.user_type});
        return;
    }
    else {
        next();
    }
}

app.get('/admin', sessionValidation, adminAuthorization, async (req,res) => {
    const result = await userCollection.find().project({username: 1, email: 1,user_type: 1, _id: 0}).toArray();

    res.render('admin', {users: result, authenticated: req.session.authenticated, user_type: req.session.user_type, req: req });
});

app.post('/toggleAdminStatus', sessionValidation, adminAuthorization, async (req, res) => {
    const username = req.body.username;
  
    const user = await userCollection.findOne({ username });
  
    const newUserType = user.user_type === "admin" ? "user" : "admin";
    await userCollection.updateOne({ username }, { $set: { user_type: newUserType } });

    if (req.session.username === username && newUserType === "user") {
        req.session.user_type = "user";
    }
  
    // Redirect back to the admin page to see the updated user list
    res.redirect('/admin');

  });

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.render('logout', { authenticated: false });
});

app.get("/does_not_exist", (req, res) => {
    res.status(404);
    res.render('notFound', {
        authenticated: req.session.authenticated,
        user_type: req.session.user_type
      });
});

app.use(express.static(__dirname + "/public"));

app.get("*", (req,res) => {
    res.redirect('/does_not_exist');
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});