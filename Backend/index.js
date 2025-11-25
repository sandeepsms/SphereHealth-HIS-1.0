// // const http=require("http");

// // const server=http.createServer((req,resp)=>{
// // console.log(resp);
// // resp.end("Hello i am sahil singh");

// // })

// // server.listen(7000,()=>{
// //     console.log("server are started...");

// // })

// const express =require('express');

// const app=express();

// const userModel=require('./usermodel');   // accept model from usermodel.js file......

// app.get('/',(req,res)=>{
// res.send("hello world bhai");
// })

// // create ....

// app.get('/create',async (req,res)=>{
// let createuser=await userModel.create({
//     name:"sahil singh rajput",
//     email:"sahil1234@gmail.com",
//     username:"sahil"

// })
// res.send(createuser);
// })

// // update......

// app.get('/update', async (req, res) => {
//   let updateuser=await userModel.findOneAndUpdate(                //ye method hai find krne ke liye kay update krna hai
//     { username: "sahil" },                                          // filter   ye username wala ka data update krna hai isliye ye yaha likha hai
//     { name: "Sahil Singh", email: "sahil350100@gmail.com" },{new:true}        // update        name aur email mai ye dhalna hai
//   );
//   res.send(updateuser);        //         update huva data ko send krdo local storage pe......
// });

// // read............

// app.get('/read',async (req,res)=>{

// let readuser=await userModel.find()                                 // use of find se mai pura data read kr skta hu kay kay create huva hai find hume ek array deta hai
// // let readuser=await userModel.find({name:"sahil singh rajput"})         // ye ek data ko find karega jo name diya gaya hai aur agar nahi mila to ek empty array return karega.....
// // let readuser=await userModel.findone({name:"sahil singh rajput"})                          // ye ek data ko find karega jo name diya gaya hai

// //  agar isi naam se multiple data hai to ye only first wala data dega aur agar nahi mila to ek empty array return karega.....

// res.send(readuser);
// })

// // delete.....

// app.get('/update',async (req,res)=>{
// let updateuser=await userModel.findOneAndUpdate(
// {username:"sahil"},{name:"sahil singh"},{email:"sahil123@gmail.com"},{email:"sahil3501@gmail.com"},{new:true}

// )
// res.send(updateuser);
// })

// app.listen(4300);

//.....................................................................................................................................................................................................

const express = require("express");
const connectDB = require("./db");
const mongoose = require("mongoose");
const cors = require("cors"); // CORS ek middleware hai jo different origin (frontend aur backend) ke beech communication allow karta hai.
const app = express(); // . Ye hi hamara server hai.

const patientRoutes = require("./routes/patientRoutes");

const doctorRoutes = require("./routes/doctorsRoutes");
const ServicebillRoutes = require("./routes/ServicebillRoutes");
const RegistrationOPDRoutes = require("./routes/Opd");
const BedRoutes=require("./routes/Bedroutes");
const WardchargesRoutes=require("./routes/WardchargesRoutes")


app.use(cors());
// Middleware
app.use(express.json()); // Ye middleware JSON data ko parse karta hai.Matlab agar frontend se tum {"name":"Sahil"} bhejo to backend usse samajh paaye.

// Database Connection
connectDB();

// Test Route
app.get("/", (req, res) => {
  res.send("Server is running with MongoDB");
});

app.use("/api/patients", patientRoutes);

app.use("/api/doctordetail", doctorRoutes);
app.use("/api/RegistrationOPD", RegistrationOPDRoutes);

app.use("/api/Servicebilldata", ServicebillRoutes);

app.use("/api/beds", BedRoutes);

app.use("/api/ward-charges", WardchargesRoutes);

// app.use("/api/patients", patientRoutes);👇👇
//Agar koi request aayi:
//http://localhost:5000/api/patients/add123

//http://localhost:5000/api/doctoradd/doctorinfo
//→ Pehle /api/patients dekha
//→ Phir patientRoutes file kholi
//→ Uske andar /add123 mila
//→ To controller (addPatient) call ho gaya. ✅

// Start Server
app.listen(5000, () => {
  console.log("🚀 Server running on port 5000");
});

// app.get("/api/patients/getallPatients", async (req, res) => {
//   try {
//     const patients = await Patient.find();
//     res.json(patients); // frontend ko data bhej diya
//   } catch (err) {
//     res.status(500).json({ error: err });
//   }
// });

// ✅ Simple Example Flow

// Client → POST /api/patients/add123

// Express → Dekhta hai /api/patients → send to patientRoutes

// Router → Dekhta hai /add123 + POST → call addPatient

// Controller → Database me patient add karta hai

// Database → Ok bolta hai

// Controller → Client ko reply: "Patient added successfully"
