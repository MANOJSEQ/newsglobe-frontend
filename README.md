# 🌍 NewsGlobe Frontend

An immersive **3D globe-based news exploration platform** that lets users discover global news visually by interacting with a rotating Earth.

This project transforms traditional news browsing into a **spatial, interactive experience**, where headlines are mapped to real-world locations.

---

## ✨ Overview

NewsGlobe allows users to:

* 🌐 Spin and explore a **3D Earth**
* 📍 Click on regions to view **location-based news**
* 📰 See global events in a **visual, intuitive way**

This frontend connects to a backend API to fetch and display news dynamically.

---

## 🚀 Features

* 🌍 **Interactive 3D Globe**

  * Smooth rotation, zoom, and navigation
  * Geographic interaction with real-world mapping

* 📰 **Location-Based News**

  * News tied to coordinates
  * Region-specific exploration

* ⚡ **Fast & Modern UI**

  * Built with React
  * Component-based architecture

* 🔗 **API Integration**

  * Fetches live or stored news data
  * Scalable for real-time updates

---

## 🛠️ Tech Stack

* **Frontend Framework:** React.js
* **3D Visualization:** Three.js / Globe.gl *(update if different)*
* **HTTP Client:** Axios / Fetch
* **Styling:** CSS / Tailwind *(update based on your project)*

---

## 📦 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/MANOJSEQ/newsglobe-frontend.git
cd newsglobe-frontend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the app

```bash
npm start
```

The app will run at:

```
http://localhost:3000
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```env
REACT_APP_API_URL=your_backend_url
REACT_APP_API_KEY=your_api_key
```

---

## 📁 Project Structure

```
src/
│── components/        # UI components (Globe, UI panels, etc.)
│── pages/            # Page-level views
│── services/         # API calls
│── hooks/            # Custom React hooks
│── utils/            # Helper functions
│── assets/           # Images, icons
│── App.js
│── index.js
```

---

## 🧠 How It Works

1. A 3D globe is rendered using WebGL
2. News data is fetched from an API
3. Articles are mapped to geographic coordinates
4. Users interact with the globe to explore stories

---

## 🔮 Future Improvements

* 🔍 Search & filter by category
* 🌡️ Heatmap of trending news regions
* 🧠 AI-generated summaries
* 🌙 Dark mode
* 📱 Mobile optimization

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the project
2. Create your feature branch
3. Commit your changes
4. Push and open a Pull Request

---

## 📄 License

MIT License

---

## 👤 Author

**Manoj**

---

## ⭐ Support

If you like this project, please ⭐ the repo — it helps a lot!
