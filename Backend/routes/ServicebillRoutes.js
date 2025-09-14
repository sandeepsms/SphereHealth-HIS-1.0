const express=require("express");
const router=express.Router();


const{Servicebillfun,TestName}=require('../controllers/Servicebillcontroller')


router.post("/addbill",Servicebillfun)

router.get("/getAllTestNames", TestName);

module.exports=router;