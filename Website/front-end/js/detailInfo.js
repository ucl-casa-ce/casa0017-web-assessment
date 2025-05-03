// Function to load CSV data
function loadCSV(filePath, callback) {
    Papa.parse(filePath, {
      download: true,
      header: true, // Automatically map CSV headers to JSON keys
      complete: function (results) {
        console.log("CSV Data Loaded:", results.data); // Debugging
        const formattedData = results.data.map(row => ({
          ...row,
          date: formatDateToHTML(row.date) // Format date to match HTML input
        }));
        callback(formattedData);
      },
      error: function (error) {
        console.error("Error loading CSV:", error);
      },
    });
  }
  
  // Function to format CSV date to "yyyy-MM-dd" for HTML date input
  function formatDateToHTML(date) {
    const parts = date.split(/[\/-]/); // Split date by "/" or "-"
    if (parts.length === 3) {
      const year = parts[0];
      const month = parts[1].padStart(2, "0"); // Ensure month has 2 digits
      const day = parts[2].padStart(2, "0"); // Ensure day has 2 digits
      return `${year}-${month}-${day}`;
    }
    return date; // Return as-is if format is unexpected
  }
  
  // Function to update detail information based on the selected date
  function updateDetailInfo(data, selectedDate) {
    const selectedRow = data.find(row => row.date === selectedDate);
  
    if (selectedRow) {
      document.getElementById("weather").textContent = selectedRow.weather || "N/A";
      document.getElementById("temperature").textContent = selectedRow.average_temperature || "N/A";
      document.getElementById("windSpeed").textContent = selectedRow.wind_speed_10m_max || "N/A";
      document.getElementById("bikeCount").textContent = selectedRow.CollisionCount || "N/A";
    } else {
      document.getElementById("weather").textContent = "N/A";
      document.getElementById("temperature").textContent = "N/A";
      document.getElementById("windSpeed").textContent = "N/A";
      document.getElementById("bikeCount").textContent = "N/A";
    }
  }
  
  // Main function to initialize date picker and button functionality
  function initDetailInfo() {
    const datePicker = document.getElementById("detailDatePicker");
    const updateButton = document.getElementById("updateDetailBtn");
  
    // Load CSV data
    loadCSV("./data2.csv", (data) => {
      // Add event listener to the update button
      updateButton.addEventListener("click", () => {
        const selectedDate = datePicker.value;
        updateDetailInfo(data, selectedDate);
      });
  
      // Optional: Set default data for the first available date
      if (data.length > 0) {
        const defaultDate = data[0].date; // First row's formatted date
        datePicker.value = defaultDate;
        updateDetailInfo(data, defaultDate);
      }
    });
  }
  
  // Initialize the script when DOM is loaded
  document.addEventListener("DOMContentLoaded", initDetailInfo);
  