/* MOBILE MENU BUTTON */
.menu-btn{
  display:none;
  background:linear-gradient(90deg,var(--purple),var(--pink));
  color:#fff;
  border:none;
  padding:10px 15px;
  border-radius:10px;
  font-size:1.4rem;
  cursor:pointer;
}

/* COPY BUTTON */
.copy-btn{
  width:100%;
  margin-top:15px;
  padding:13px;
  border:none;
  border-radius:12px;
  background:linear-gradient(90deg,var(--cyan),var(--purple));
  color:#fff;
  font-family:'Orbitron',sans-serif;
  cursor:pointer;
  transition:.3s;
}

.copy-btn:hover{
  transform:translateY(-2px);
  box-shadow:0 0 20px rgba(0,245,255,.35);
}

/* TOAST POPUP */
.toast{
  position:fixed;
  bottom:25px;
  right:25px;
  max-width:320px;
  background:linear-gradient(90deg,var(--purple),var(--pink));
  color:#fff;
  padding:16px 22px;
  border-radius:16px;
  font-size:.95rem;
  z-index:10000;
  box-shadow:0 0 25px rgba(255,0,200,.35);
  animation:toastPop .25s ease;
}

@keyframes toastPop{
  from{
    opacity:0;
    transform:translateY(20px);
  }

  to{
    opacity:1;
    transform:translateY(0);
  }
}

/* BETTER MOBILE NAV */
@media(max-width:650px){

  header{
    flex-direction:row;
    align-items:center;
  }

  .menu-btn{
    display:block;
  }

  nav{
    display:none;
    position:absolute;
    top:90px;
    left:6%;
    right:6%;
    background:rgba(0,0,0,.95);
    border:1px solid rgba(255,255,255,.08);
    border-radius:20px;
    padding:20px;
    flex-direction:column;
    z-index:99;
  }

  nav.active{
    display:flex;
  }

  nav a,
  nav button{
    width:100%;
    text-align:center;
  }

  .toast{
    left:20px;
    right:20px;
    bottom:20px;
    max-width:none;
  }
}