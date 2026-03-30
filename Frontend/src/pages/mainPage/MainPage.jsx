import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "../../../css/mainpage.css";
const menuItems = [
  { name: "OPD", path: "/registration/OPD" },

  { name: "IPD", path: "/registration/IPD" },
  { name: "Emergency", path: "/emergency" },
  { name: "Doctor", path: "/doctor" },
  { name: "Nursing", path: "/nursing" },
  { name: "Pharmacy", path: "/pharmacy" },
  { name: "Billing", path: "/billing" },
  { name: "Reports", path: "/reports" },
];

const Dashboard = () => {
  const navigate = useNavigate();  

  return (
    <div className="container text-center mt-5">
      <h2 className="mb-4">Hospital Management</h2>

      <div className="row g-4 justify-content-center">
        {menuItems.map((item, index) => (
          <div className="col-md-3 col-sm-4 col-6" key={index}>
            <div onClick={() => navigate(item.path)} className="menu-card">
              <div className="menu-icon">{item.name[0]}</div>

              <h6 className="mt-2">{item.name}</h6>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
