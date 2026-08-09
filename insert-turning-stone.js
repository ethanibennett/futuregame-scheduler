const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'poker-tournaments.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const venue = 'Turning Stone Casino';
  const prefix = 'TS';

  const events = [
    // Thursday, March 12, 2026
    {date:'March 12, 2026',time:'10:00 AM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 12, 2026',time:'11:00 AM',num:'1',name:'30K Opener NLH $50K Guarantee (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 12, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 12, 2026',time:'4:00 PM',num:'2A',name:'Mini Main NLH $500K Guarantee (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 12, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},

    // Friday, March 13, 2026
    {date:'March 13, 2026',time:'10:00 AM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 13, 2026',time:'11:00 AM',num:'2B',name:'Mini Main NLH $500K Guarantee (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 13, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 13, 2026',time:'4:00 PM',num:'2C',name:'Mini Main NLH $500K Guarantee (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 13, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},

    // Saturday, March 14, 2026
    {date:'March 14, 2026',time:'10:00 AM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 14, 2026',time:'11:00 AM',num:'2D',name:'Mini Main NLH $500K Guarantee (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 14, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 14, 2026',time:'4:00 PM',num:'3',name:'NLH $50K Guarantee (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 14, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},

    // Sunday, March 15, 2026
    {date:'March 15, 2026',time:'10:00 AM',num:'4',name:'Seniors NLH $100K Guaranteed Re-Entry (Limited to age 50+) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 15, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 15, 2026',time:'3:00 PM',num:'5',name:'Black Chip Bounty NLH $100K GTD (Re-Entry) (2 day event - Official Ring Event)',buyin:600,variant:'NLH',bounty:true},
    {date:'March 15, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},

    // Monday, March 16, 2026
    {date:'March 16, 2026',time:'10:00 AM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 16, 2026',time:'11:00 AM',num:'6',name:'Six Max NLH $50K GTD (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 16, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 16, 2026',time:'4:00 PM',num:'7',name:'Pot Limit Omaha $50K GTD Play to 9 (Re-Entry) (2 day event - Official Ring Event)',buyin:600,variant:'PLO'},
    {date:'March 16, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},

    // Tuesday, March 17, 2026
    {date:'March 17, 2026',time:'10:00 AM',num:'8A',name:'Monster Stack NLH $200K GTD (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 17, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 17, 2026',time:'4:00 PM',num:'8B',name:'Monster Stack NLH $200K GTD (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 17, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},
    {date:'March 17, 2026',time:'9:00 PM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},

    // Wednesday, March 18, 2026
    {date:'March 18, 2026',time:'10:00 AM',num:'8C',name:'Monster Stack NLH $200K GTD (Re-Entry) (2 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 18, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 18, 2026',time:'4:00 PM',num:'9',name:'NLH / PLO $50K GTD Play to 9 (Re-Entry) (2 day event - Official Ring Event)',buyin:600,variant:'NLH/PLO'},
    {date:'March 18, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},
    {date:'March 18, 2026',time:'9:00 PM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},

    // Thursday, March 19, 2026
    {date:'March 19, 2026',time:'10:00 AM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},
    {date:'March 19, 2026',time:'11:00 AM',num:'10A',name:'Main Event NLH $1M GTD (1 Re-Entry per Flight) (3 day event - Official Ring Event)',buyin:1700,variant:'NLH'},
    {date:'March 19, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 19, 2026',time:'4:00 PM',num:'11',name:'NLH $50K GTD (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 19, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},
    {date:'March 19, 2026',time:'9:00 PM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},

    // Friday, March 20, 2026
    {date:'March 20, 2026',time:'10:00 AM',num:'12',name:'Ladies NLH $25K GTD (Re-Entry) (1 day event - Official Ring Event)',buyin:300,variant:'NLH'},
    {date:'March 20, 2026',time:'10:00 AM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},
    {date:'March 20, 2026',time:'11:00 AM',num:'10B',name:'Main Event NLH $1M GTD (1 Re-Entry per Flight) (3 day event - Official Ring Event)',buyin:1700,variant:'NLH'},
    {date:'March 20, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 20, 2026',time:'4:00 PM',num:'13',name:'NLH $25K Guarantee (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 20, 2026',time:'7:00 PM',num:'',name:'Deepstack NLH Re-Entry',buyin:140,variant:'NLH'},
    {date:'March 20, 2026',time:'9:00 PM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},

    // Saturday, March 21, 2026
    {date:'March 21, 2026',time:'10:00 AM',num:'',name:'Landmark Mega NLH Pays $2000',buyin:250,variant:'NLH',sat:true},
    {date:'March 21, 2026',time:'11:00 AM',num:'10C',name:'Main Event NLH $1M GTD (1 Re-Entry per Flight) (3 day event - Official Ring Event)',buyin:1700,variant:'NLH'},
    {date:'March 21, 2026',time:'2:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 21, 2026',time:'4:00 PM',num:'14',name:'NLH $50K Guarantee (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 21, 2026',time:'7:00 PM',num:'15',name:'Turbo NLH $25K Guarantee (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},

    // Sunday, March 22, 2026
    {date:'March 22, 2026',time:'10:00 AM',num:'16',name:'40/40/40 NLH $100K Guaranteed Re-Entry (Limited to age 40+) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
    {date:'March 22, 2026',time:'12:00 PM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 22, 2026',time:'4:00 PM',num:'17',name:'NLH $50K GTD (Re-Entry) (1 day event - Official Ring Event)',buyin:600,variant:'NLH'},
    {date:'March 22, 2026',time:'7:00 PM',num:'',name:'Tag Team NLH (Re-Entry) $200/$200',buyin:400,variant:'NLH'},

    // Monday, March 23, 2026
    {date:'March 23, 2026',time:'10:00 AM',num:'',name:'Cash Survivor',buyin:100,variant:'NLH'},
    {date:'March 23, 2026',time:'11:00 AM',num:'18',name:'Double Stack NLH $30K Guarantee (Re-Entry) (1 day event - Official Ring Event)',buyin:400,variant:'NLH'},
  ];

  let inserted = 0;
  for (const e of events) {
    const eventNum = e.num ? `${prefix}-${e.num}` : '';
    db.run(
      `INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, reentry, is_satellite, source_pdf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventNum, e.name, e.date, e.time, e.buyin, e.variant, venue, 'Re-Entry', e.sat ? 1 : 0, 'WSOP Circuit Turning Stone 2026']
    );
    inserted++;
  }

  console.log(`Inserted ${inserted} Turning Stone events`);

  // Verify
  const countStmt = db.prepare("SELECT COUNT(*) as cnt FROM tournaments WHERE venue = ?");
  countStmt.bind([venue]);
  countStmt.step();
  console.log('Turning Stone events in DB:', countStmt.getAsObject().cnt);
  countStmt.free();

  const totalStmt = db.prepare("SELECT COUNT(*) as cnt FROM tournaments");
  totalStmt.step();
  console.log('Total tournaments:', totalStmt.getAsObject().cnt);
  totalStmt.free();

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  console.log('Database saved');
})();
