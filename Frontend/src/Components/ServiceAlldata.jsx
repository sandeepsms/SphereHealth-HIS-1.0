import React, { useState, useEffect } from 'react';
import { TreeTable } from 'primereact/treetable';
import { Column } from 'primereact/column';


export default function ServiceAlldata(){
 const [nodes, setNodes] = useState([
    {id:1,
        Name:"sahil",
        age:23
    },{id:2,
        Name:"Rahul",
        age:27},{id:3,
        Name:"Kabir",
        age:21}
 ]);

    // useEffect(() => {
    //     nodes.getTreeTableNodes().then((data) => setNodes(data));
    // }, []);

    return (
        <div className="card" style={{marginTop:"150px"}}>
            <TreeTable value={nodes} tableStyle={{ minWidth: '50rem' }}>
                <Column field="name" header="Name" expander></Column>
                <Column field="size" header="Size"></Column>
                <Column field="type" header="Type"></Column>
            </TreeTable>
        </div>
    );
}
