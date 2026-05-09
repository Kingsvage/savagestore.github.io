emailjs.init("YOUR_EMAILJS_PUBLIC_KEY");

const ADMIN_PHONE = "2347120004769";

let currentOrder = {
  item: "",
  price: 0
};


function scrollToSection(id){
  document.getElementById(id).scrollIntoView({
    behavior:"smooth"
  });
}


window.scrollToSection = scrollToSection;


window.signInWithGoogle = () => {
  alert("Firebase Google Authentication goes here ⚡");
};


window.openOrderModal = (item,price) => {
  currentOrder.item = item;
  currentOrder.price = price;

  document.getElementById("order-summary").innerHTML = `
    <strong>${item}</strong><br><br>
    Price: ₦${price.toLocaleString()}
  `;

  document.getElementById("order-modal").classList.remove("hidden");
};


window.closeModal = () => {
  document.getElementById("order-modal").classList.add("hidden");
};


window.completeOrder = async () => {

  const uid = document.getElementById("uid").value.trim();
  const email = document.getElementById("email").value.trim();

  if(!uid || !email){
    alert("Please fill all fields.");
    return;
  }

  const message = `
SAVAGE STORE ORDER

ITEM: ${currentOrder.item}
PRICE: ₦${currentOrder.price}
UID: ${uid}
EMAIL: ${email}
  `;

  const whatsappURL = `https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(message)}`;

  window.open(whatsappURL,"_blank");

  try{

    await emailjs.send(
      "YOUR_SERVICE_ID",
      "YOUR_TEMPLATE_ID",
      {
        item: currentOrder.item,
        price: currentOrder.price,
        uid,
        email
      }
    );

  }catch(err){
    console.log(err);
  }

  closeModal();

  alert("Redirecting to WhatsApp ⚡");
};


window.addEventListener("scroll",()=>{

  const header = document.querySelector("header");

  if(window.scrollY > 40){
    header.style.background = "rgba(0,0,0,.8)";
    header.style.backdropFilter = "blur(10px)";
  }else{
    header.style.background = "transparent";
    header.style.backdropFilter = "none";
  }
});
