const express=require("express");
const router=express.Router();


const{Servicebillfun,TestName,getOPDPrice ,getTpaId}=require('../controllers/Servicebillcontroller')


router.post("/addbill",Servicebillfun)

router.get("/getAllTestNames", TestName);

router.get("/getOPDPrice", getOPDPrice);

router.get("/getTpaId/:TpaId", getTpaId);


// router.get("/getallservicefromregistrationtpaName",RegistrationTpaService)

module.exports=router;